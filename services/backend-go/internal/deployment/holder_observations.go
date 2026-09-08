package deployment

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strconv"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

const HolderObservationScope = "market-curve-gauge-vault-fees-holder-v1"
const MaxHolderEpochReads = 2048
const MaxHistoricalServiceAssets = 4096

type ServiceAssetTarget struct{ Distributor, Asset string }

var treasuryMarketFields = []events.Input{{Name: "memeToken", Type: "address"}, {Name: "quoteToken", Type: "address"}, {Name: "eligibilityPolicyHash", Type: "bytes32"}, {Name: "activatedAt", Type: "uint64"}}
var treasuryEpochFields = []events.Input{
	{Name: "requestedAt", Type: "uint64"}, {Name: "publishBy", Type: "uint64"}, {Name: "finalizeAfter", Type: "uint64"}, {Name: "claimUntil", Type: "uint64"}, {Name: "sourceBlockNumber", Type: "uint64"}, {Name: "leafCount", Type: "uint32"}, {Name: "status", Type: "uint8"}, {Name: "requester", Type: "address"}, {Name: "serviceFeeAsset", Type: "address"}, {Name: "serviceFeeAmount", Type: "uint128"}, {Name: "sourceBlockHash", Type: "bytes32"}, {Name: "merkleRoot", Type: "bytes32"}, {Name: "datasetHash", Type: "bytes32"}, {Name: "quoteAmount", Type: "uint256"}, {Name: "claimedAmount", Type: "uint256"}, {Name: "totalTwab", Type: "uint256"},
}

// ObserveHolderBlock covers the Treasury markets registered by the Factory's
// immutable creatorFeesToHolders option. Independently registered treasuries,
// all service-credit beneficiaries and Merkle dataset reconstruction need their
// own discovery/reconciliation; this batch never asserts full reconciliation.
func ObserveHolderBlock(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, markets map[string]MarketDiscovery, historical ...ServiceAssetTarget) (ObservationBatch, error) {
	fail := func(e error) (ObservationBatch, error) { return ObservationBatch{}, e }
	if len(historical) > MaxHistoricalServiceAssets {
		return fail(errors.New("historical service asset budget exceeded"))
	}
	for _, target := range historical {
		if !hex20.MatchString(target.Distributor) || target.Distributor == zero20 || !hex20.MatchString(target.Asset) {
			return fail(errors.New("invalid historical service asset"))
		}
	}
	if _, e := VerifyCoreBindings(ctx, rpc, m, block); e != nil {
		return fail(e)
	}
	batch := ObservationBatch{Scope: HolderObservationScope, ChainID: m.ChainID, BlockNumber: block.Number, BlockHash: block.Hash, Observations: []StateObservation{}}
	ids := map[string]bool{}
	for id, market := range markets {
		sharing, ok := market.State["creatorFeesToHolders"].(bool)
		if !ok || !hex32.MatchString(id) || market.MarketID != id {
			return fail(errors.New("invalid Holder market identity"))
		}
		if sharing {
			ids[id] = true
		}
	}
	if len(ids) == 0 {
		return batch, nil
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		roots[c.Module] = c.Address
	}
	read := businessReader(ctx, rpc, block)
	single := func(address, sig, args, typ string) (string, error) {
		v, e := read(address, sig, args, []events.Input{{Name: "value", Type: typ}})
		if e != nil {
			return "", e
		}
		return v["value"].(string), nil
	}
	distributor, e := single(roots["TickerGardenFactoryV1"], "treasuryDistributor()", "", "address")
	if e != nil {
		return fail(e)
	}
	code, e := rpc.CodeAt(ctx, distributor, block.Hash)
	if e != nil || len(code) == 0 || distributor == zero20 {
		return fail(errors.New("Treasury runtime unavailable"))
	}
	if expected := roots["TreasuryDistributorV1"]; expected != "" && expected != distributor {
		return fail(errors.New("Treasury manifest mismatch"))
	}
	registry, e := single(distributor, "marketRegistry()", "", "address")
	if e != nil {
		return fail(e)
	}
	if registry != roots["MarketRegistryV1"] {
		return fail(errors.New("Treasury Registry mismatch"))
	}
	if expected := roots["HolderRewardsDistributorV1"]; expected != "" {
		if expected != distributor || roots["TreasuryDistributorV1"] != "" {
			return fail(errors.New("ambiguous continuous Holder manifest"))
		}
		return observeContinuousHolders(ctx, rpc, m, block, markets, roots, distributor, code)
	}
	serviceTreasury, e := single(distributor, "rootServiceTreasury()", "", "address")
	if e != nil {
		return fail(e)
	}
	if serviceTreasury == zero20 || serviceTreasury == distributor {
		return fail(errors.New("invalid root service treasury"))
	}
	timing := map[string]string{}
	for _, field := range []string{"finalityDelaySeconds", "finalityDelayBlocks", "rootPublicationWindow", "rootReviewDelay", "claimWindow"} {
		typ := "uint32"
		if field == "finalityDelayBlocks" {
			typ = "uint16"
		}
		value, err := single(distributor, field+"()", "", typ)
		if err != nil {
			return fail(err)
		}
		n, err := strconv.ParseUint(value, 10, 32)
		if err != nil || n == 0 || (field == "finalityDelayBlocks" && n > 255) {
			return fail(errors.New("invalid Treasury timing policy"))
		}
		timing[field] = value
	}
	fee, e := read(distributor, "rootServiceFee()", "", []events.Input{{Name: "asset", Type: "address"}, {Name: "amount", Type: "uint128"}})
	if e != nil {
		return fail(e)
	}
	duration, e := single(distributor, "EPOCH_DURATION()", "", "uint32")
	if e != nil {
		return fail(e)
	}
	schema, e := single(distributor, "TWAB_SCHEMA()", "", "bytes32")
	if e != nil {
		return fail(e)
	}
	if duration == "0" || schema == zero32 {
		return fail(errors.New("invalid Treasury epoch policy"))
	}
	assets := map[string]bool{fee["asset"].(string): true}
	for _, target := range historical {
		if target.Distributor == distributor {
			assets[target.Asset] = true
		}
	}
	sums := map[string]*big.Int{}
	number := func(s string) *big.Int { n, _ := new(big.Int).SetString(s, 10); return n }
	counts := map[string]uint64{}
	views := map[string]map[string]any{}
	remaining := uint64(MaxHolderEpochReads)
	for _, id := range sortedSet(ids) {
		market := markets[id]
		meme, ok := market.State["memeToken"].(string)
		if !ok || !hex20.MatchString(meme) || meme == zero20 {
			return fail(errors.New("invalid Holder Meme"))
		}
		quote, ok := market.State["quoteAsset"].(string)
		if !ok || !hex20.MatchString(quote) || quote == meme {
			return fail(errors.New("invalid Holder Quote"))
		}
		// The token is authenticated against its discovery-time runtime, not merely
		// trusted because an arbitrary contract returns this distributor address.
		tokenCode, e := rpc.CodeAt(ctx, meme, block.Hash)
		if e != nil {
			return fail(e)
		}
		pinned := false
		for _, c := range market.Contracts {
			if c.Module == "TickerMemeTokenV1" && c.Address == meme && len(tokenCode) > 0 && c.RuntimeCodeHash == Hash(tokenCode) {
				pinned = true
			}
		}
		if !pinned {
			return fail(errors.New("Holder Meme runtime mismatch"))
		}
		tokenDistributor, e := single(meme, "treasuryDistributor()", "", "address")
		if e != nil {
			return fail(e)
		}
		if tokenDistributor != distributor {
			return fail(errors.New("Holder token distributor mismatch"))
		}
		v, e := read(distributor, "market(bytes32)", id[2:], treasuryMarketFields)
		if e != nil {
			return fail(e)
		}
		if v["memeToken"] != meme || v["quoteToken"] != quote || v["activatedAt"] == "0" || v["eligibilityPolicyHash"] == zero32 {
			return fail(errors.New("Holder Treasury market mismatch"))
		}
		vault, e := single(distributor, "feeSharingVault(bytes32)", id[2:], "address")
		if e != nil {
			return fail(e)
		}
		if vault != roots["ProtocolFeeVault"] {
			return fail(errors.New("Holder FeeVault mismatch"))
		}
		countRaw, e := single(distributor, "currentEpochId(bytes32)", id[2:], "uint32")
		if e != nil {
			return fail(e)
		}
		count, e := strconv.ParseUint(countRaw, 10, 32)
		if e != nil || count == 0 || count > remaining {
			return fail(errors.New("Holder epoch budget exceeded or uninitialized; paged rebuild required"))
		}
		remaining -= count
		counts[id] = count
		views[id] = v
		assets[quote] = true
		if sums[quote] == nil {
			sums[quote] = new(big.Int)
		}
		batch.Expected += 1 + int(count)
	}
	for _, id := range sortedSet(ids) {
		v := views[id]
		quote, meme := v["quoteToken"].(string), v["memeToken"].(string)
		holderSums := map[string]*big.Int{quote: new(big.Int), meme: new(big.Int)}
		for epoch := uint64(1); epoch <= counts[id]; epoch++ {
			args := id[2:] + fmt.Sprintf("%064x", epoch)
			row, e := read(distributor, "epoch(bytes32,uint32)", args, treasuryEpochFields)
			if e != nil {
				return fail(e)
			}
			status, _ := strconv.ParseUint(row["status"].(string), 10, 8)
			if status > 4 {
				return fail(errors.New("invalid Treasury epoch status"))
			}
			funded, e := single(distributor, "epochQuoteAmount(bytes32,uint32)", args, "uint256")
			if e != nil {
				return fail(e)
			}
			window, e := read(distributor, "epochWindow(bytes32,uint32)", args, []events.Input{{Name: "start", Type: "uint64"}, {Name: "end", Type: "uint64"}})
			if e != nil {
				return fail(e)
			}
			row["marketId"] = id
			row["epoch"] = strconv.FormatUint(epoch, 10)
			row["treasuryDistributor"] = distributor
			row["quoteAsset"] = quote
			row["memeAsset"] = meme
			row["fundedQuoteAmount"] = funded
			row["window"] = window
			checks := map[string]bool{"windowOrdered": number(window["start"].(string)).Cmp(number(window["end"].(string))) < 0, "claimedWithinCommitted": number(row["claimedAmount"].(string)).Cmp(number(row["quoteAmount"].(string))) <= 0}
			outstanding := new(big.Int)
			if status == 4 {
				checks["rolledOverFundingCleared"] = funded == "0"
			} else {
				outstanding.Sub(number(funded), number(row["claimedAmount"].(string)))
				checks["claimedWithinFunding"] = outstanding.Sign() >= 0
				if status > 0 {
					checks["fundingEqualsCommitment"] = funded == row["quoteAmount"]
				}
			}
			row["outstandingQuoteAmount"] = outstanding.String()
			row["checks"] = checks
			sums[quote].Add(sums[quote], outstanding)
			for _, a := range []struct{ asset, name string }{{quote, "holderQuoteLiability"}, {meme, "holderMemeLiability"}} {
				raw, e := single(roots["ProtocolFeeVault"], "holderLiability(bytes32,uint32,address)", args+addressArgument(a.asset), "uint256")
				if e != nil {
					return fail(e)
				}
				row[a.name] = raw
				holderSums[a.asset].Add(holderSums[a.asset], number(raw))
			}
			// Historical service-fee assets remain liabilities even after rootServiceFee changes.
			if row["serviceFeeAmount"] != "0" {
				assets[row["serviceFeeAsset"].(string)] = true
			}
			batch.Observations = append(batch.Observations, StateObservation{Kind: "holderEpoch", Key: id + ":" + strconv.FormatUint(epoch, 10), Value: row})
		}
		checks := map[string]bool{}
		for _, a := range []struct{ asset, name string }{{quote, "quoteEpochSumEqualsBucket"}, {meme, "memeEpochSumEqualsBucket"}} {
			raw, e := single(roots["ProtocolFeeVault"], "liability(bytes32,address,uint8)", id[2:]+addressArgument(a.asset)+fmt.Sprintf("%064x", 3), "uint256")
			if e != nil {
				return fail(e)
			}
			checks[a.name] = holderSums[a.asset].Cmp(number(raw)) == 0
		}
		v["marketId"] = id
		v["treasuryDistributor"] = distributor
		v["treasuryRuntimeCodeHash"] = Hash(code)
		v["currentEpochId"] = strconv.FormatUint(counts[id], 10)
		for field, value := range timing {
			v[field] = value
		}
		v["rootServiceTreasury"] = serviceTreasury
		v["currentServiceFeeAsset"] = fee["asset"]
		v["currentServiceFeeAmount"] = fee["amount"]
		v["epochDuration"] = duration
		v["twabSchema"] = schema
		v["holderQuoteEpochSum"] = holderSums[quote].String()
		v["holderMemeEpochSum"] = holderSums[meme].String()
		v["checks"] = checks
		v["fullReconciliation"] = false
		batch.Observations = append(batch.Observations, StateObservation{Kind: "holderMarket", Key: id, Value: v})
	}
	batch.Expected += len(assets)
	for _, asset := range sortedSet(assets) {
		quote, e := single(distributor, "totalQuoteLiability(address)", addressArgument(asset), "uint256")
		if e != nil {
			return fail(e)
		}
		service, e := single(distributor, "totalServiceLiability(address)", addressArgument(asset), "uint256")
		if e != nil {
			return fail(e)
		}
		var balance string
		if asset == zero20 {
			native, ok := rpc.(interface {
				BalanceAt(context.Context, string, string) (string, error)
			})
			if !ok {
				return fail(errors.New("native Treasury balance observer required"))
			}
			balance, e = native.BalanceAt(ctx, distributor, block.Hash)
			if e != nil {
				return fail(e)
			}
			n, ok := new(big.Int).SetString(balance, 10)
			if !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != balance {
				return fail(errors.New("invalid Treasury native balance"))
			}
		} else {
			balance, e = single(asset, "balanceOf(address)", addressArgument(distributor), "uint256")
			if e != nil {
				return fail(e)
			}
		}
		required := new(big.Int).Add(number(quote), number(service))
		sum := sums[asset]
		if sum == nil {
			sum = new(big.Int)
		}
		batch.Observations = append(batch.Observations, StateObservation{Kind: "treasurySolvency", Key: distributor + ":" + asset, Value: map[string]any{"treasuryDistributor": distributor, "asset": asset, "totalQuoteLiability": quote, "totalServiceLiability": service, "requiredBalance": required.String(), "balance": balance, "knownHolderMarketOutstanding": sum.String(), "fullReconciliation": false, "checks": map[string]bool{"balanceCoversLiabilities": number(balance).Cmp(required) >= 0, "knownHolderSumEqualsQuoteLiability": sum.Cmp(number(quote)) == 0}}})
	}
	end, e := rpc.Header(ctx, block.Number)
	if e != nil {
		return fail(e)
	}
	if end.Hash != block.Hash {
		return fail(errors.New("Holder observation block changed"))
	}
	return batch, nil
}
