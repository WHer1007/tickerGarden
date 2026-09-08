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

const FeeObservationScope = "market-curve-gauge-vault-fees-v1"

// Exceeding the synchronous read budget fails the block, never returns a partial
// epoch sum. Larger histories need paged observation jobs before production use.
const MaxCreatorEpochReads = 1024

// ObserveFeeBlock reads current buckets and all Creator epochs within a bounded
// budget. Holder epoch/Treasury accounting and complete market enumeration remain
// separate reconciliation requirements. No financial values are event deltas.
func ObserveFeeBlock(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, markets map[string]MarketDiscovery) (ObservationBatch, error) {
	fail := func(err error) (ObservationBatch, error) { return ObservationBatch{}, err }
	if _, err := VerifyCoreBindings(ctx, rpc, m, block); err != nil {
		return fail(err)
	}
	timestamp, err := block.Time()
	if err != nil {
		return fail(errors.New("invalid fee observation timestamp"))
	}
	batch := ObservationBatch{Scope: FeeObservationScope, ChainID: m.ChainID, BlockNumber: block.Number, BlockHash: block.Hash, Observations: []StateObservation{}}
	if len(markets) == 0 {
		return batch, nil
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		roots[c.Module] = c.Address
	}
	vault := roots["ProtocolFeeVault"]
	read := businessReader(ctx, rpc, block)
	single := func(address, signature, args, name, typ string) (any, error) {
		v, e := read(address, signature, args, []events.Input{{Name: name, Type: typ}})
		if e != nil {
			return nil, e
		}
		return v[name], nil
	}
	registry, err := single(vault, "marketRegistry()", "", "address", "address")
	if err != nil {
		return fail(err)
	}
	if registry != roots["MarketRegistryV1"] {
		return fail(errors.New("FeeVault market Registry mismatch"))
	}
	creator, err := single(vault, "creatorRevenueRegistry()", "", "address", "address")
	if err != nil {
		return fail(err)
	}
	creatorAddress := creator.(string)
	code, err := rpc.CodeAt(ctx, creatorAddress, block.Hash)
	if err != nil || len(code) == 0 || creatorAddress == zero20 {
		return fail(errors.New("Creator Registry runtime unavailable"))
	}
	if expected := roots["CreatorRevenueRegistry"]; expected != "" && expected != creatorAddress {
		return fail(errors.New("Creator Registry manifest mismatch"))
	}
	for _, edge := range []struct{ signature, module string }{{"factory()", "TickerGardenFactoryV1"}, {"marketRegistry()", "MarketRegistryV1"}} {
		value, e := single(creatorAddress, edge.signature, "", "address", "address")
		if e != nil {
			return fail(e)
		}
		if value != roots[edge.module] {
			return fail(errors.New("Creator Registry binding mismatch"))
		}
	}
	policy, err := single(vault, "feePolicyId()", "", "policy", "bytes32")
	if err != nil {
		return fail(err)
	}
	ids := map[string]bool{}
	for id := range markets {
		ids[id] = true
	}
	epochCounts := map[string]uint64{}
	remaining := uint64(MaxCreatorEpochReads)
	assets := map[string]bool{}
	assetMarketCounts := map[string]int{}
	for _, id := range sortedSet(ids) {
		market := markets[id]
		if !hex32.MatchString(id) || market.MarketID != id || market.State["feePolicyId"] != policy {
			return fail(errors.New("FeeVault market policy mismatch"))
		}
		for _, name := range []string{"quoteAsset", "memeToken"} {
			asset, ok := market.State[name].(string)
			if !ok || !hex20.MatchString(asset) {
				return fail(errors.New("invalid fee asset"))
			}
			assets[asset] = true
			assetMarketCounts[asset]++
		}
		value, e := single(creatorAddress, "currentCreatorEpoch(bytes32)", id[2:], "epoch", "uint32")
		if e != nil {
			return fail(e)
		}
		count, e := strconv.ParseUint(value.(string), 10, 32)
		if e != nil || count == 0 {
			return fail(errors.New("Creator epoch uninitialized"))
		}
		if count > remaining {
			return fail(errors.New("Creator epoch observation budget exceeded; paged rebuild required"))
		}
		remaining -= count
		epochCounts[id] = count
		batch.Expected += 2 + int(count) // two asset bucket records + one dual-asset record per epoch
	}
	batch.Expected += len(assets)
	sums := map[string]*big.Int{}
	for asset := range assets {
		sums[asset] = new(big.Int)
	}
	number := func(s string) *big.Int { v, _ := new(big.Int).SetString(s, 10); return v }
	amount := func(signature, args string) (string, error) {
		v, e := single(vault, signature, args, "amount", "uint256")
		if e != nil {
			return "", e
		}
		return v.(string), nil
	}
	for _, id := range sortedSet(ids) {
		market := markets[id].State
		quote, meme := market["quoteAsset"].(string), market["memeToken"].(string)
		if quote == meme || meme == zero20 {
			return fail(errors.New("invalid dual fee assets"))
		}
		exitTimes := map[string]string{}
		creatorSums := map[string]*big.Int{quote: new(big.Int), meme: new(big.Int)}
		for epoch := uint64(1); epoch <= epochCounts[id]; epoch++ {
			word := fmt.Sprintf("%064x", epoch)
			beneficiary, e := single(creatorAddress, "creatorBeneficiaryAt(bytes32,uint32)", id[2:]+word, "beneficiary", "address")
			if e != nil {
				return fail(e)
			}
			if beneficiary == zero20 || (epoch == 1 && beneficiary != market["creatorRevenueBeneficiaryAtCreation"]) {
				return fail(errors.New("Creator epoch beneficiary mismatch"))
			}
			// The exit request is scoped to market/beneficiary, shared across that
			// beneficiary's epochs. Read it at the same pinned block as liabilities.
			exitAt, cached := exitTimes[beneficiary.(string)]
			if !cached {
				exitAt, e = amount("rawRewardExitAt(bytes32,address)", id[2:]+addressArgument(beneficiary.(string)))
				if e != nil {
					return fail(e)
				}
				exitTimes[beneficiary.(string)] = exitAt
			}
			exitNumber := number(exitAt)
			values := map[string]any{"marketId": id, "epoch": strconv.FormatUint(epoch, 10), "beneficiary": beneficiary, "creatorRegistry": creatorAddress, "creatorRegistryRuntimeCodeHash": Hash(code), "quoteAsset": quote, "memeAsset": meme, "rawRewardExitAt": exitAt, "rawRewardExitReady": exitNumber.Sign() > 0 && exitNumber.Cmp(new(big.Int).SetUint64(timestamp)) <= 0, "observedAtTimestamp": strconv.FormatUint(timestamp, 10)}
			for _, entry := range []struct{ asset, name string }{{quote, "quoteLiability"}, {meme, "memeLiability"}} {
				raw, e := amount("creatorLiability(bytes32,uint32,address)", id[2:]+word+addressArgument(entry.asset))
				if e != nil {
					return fail(e)
				}
				values[entry.name] = raw
				creatorSums[entry.asset].Add(creatorSums[entry.asset], number(raw))
			}
			batch.Observations = append(batch.Observations, StateObservation{Kind: "creatorEpoch", Key: id + ":" + strconv.FormatUint(epoch, 10), Value: values})
		}
		for _, asset := range []string{quote, meme} {
			values := map[string]any{"marketId": id, "feeAsset": asset, "feeVault": vault, "creatorEpochCount": strconv.FormatUint(epochCounts[id], 10), "holderEpochCoverageComplete": false}
			sum := new(big.Int)
			for bucket, name := range []string{"creator", "staker", "platform", "holder"} {
				raw, e := amount("liability(bytes32,address,uint8)", id[2:]+addressArgument(asset)+fmt.Sprintf("%064x", bucket))
				if e != nil {
					return fail(e)
				}
				values[name] = raw
				sum.Add(sum, number(raw))
			}
			reserve, e := amount("forfeitureReserve(bytes32,address)", id[2:]+addressArgument(asset))
			if e != nil {
				return fail(e)
			}
			sum.Add(sum, number(reserve))
			values["forfeitureReserve"] = reserve
			values["bucketAndReserveTotal"] = sum.String()
			values["creatorEpochSum"] = creatorSums[asset].String()
			values["checks"] = map[string]bool{"creatorEpochSumEqualsBucket": creatorSums[asset].Cmp(number(values["creator"].(string))) == 0}
			sums[asset].Add(sums[asset], sum)
			batch.Observations = append(batch.Observations, StateObservation{Kind: "feeLiability", Key: id + ":" + asset, Value: values})
		}
	}
	for _, asset := range sortedSet(assets) {
		total, e := amount("totalLiability(address)", addressArgument(asset))
		if e != nil {
			return fail(e)
		}
		var balance string
		if asset == zero20 {
			native, ok := rpc.(interface {
				BalanceAt(context.Context, string, string) (string, error)
			})
			if !ok {
				return fail(errors.New("native balance observer required"))
			}
			balance, e = native.BalanceAt(ctx, vault, block.Hash)
			if e != nil {
				return fail(errors.New("native FeeVault balance unavailable"))
			}
			if n, ok := new(big.Int).SetString(balance, 10); !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != balance {
				return fail(errors.New("invalid native FeeVault balance"))
			}
		} else {
			v, err := single(asset, "balanceOf(address)", addressArgument(vault), "amount", "uint256")
			if err != nil {
				return fail(err)
			}
			balance = v.(string)
		}
		batch.Observations = append(batch.Observations, StateObservation{Kind: "feeSolvency", Key: asset, Value: map[string]any{"feeAsset": asset, "feeVault": vault, "totalLiability": total, "balance": balance, "knownMarketLiabilitySum": sums[asset].String(), "knownMarketCount": assetMarketCounts[asset], "fullReconciliation": false, "checks": map[string]bool{"balanceCoversLiability": number(balance).Cmp(number(total)) >= 0, "knownMarketSumEqualsTotal": sums[asset].Cmp(number(total)) == 0}}})
	}
	end, err := rpc.Header(ctx, block.Number)
	if err != nil {
		return fail(err)
	}
	if end.Hash != block.Hash {
		return fail(errors.New("FeeVault observation block changed"))
	}
	return batch, nil
}
