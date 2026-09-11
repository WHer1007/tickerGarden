package deployment

import (
	"context"
	"errors"
	"math/big"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

var continuousMarketFields = []events.Input{
	{Name: "token", Type: "address"}, {Name: "quote", Type: "address"}, {Name: "vault", Type: "address"},
	{Name: "updatedAt", Type: "uint64"}, {Name: "head", Type: "uint8"}, {Name: "count", Type: "uint8"},
	{Name: "supply", Type: "uint256"}, {Name: "index", Type: "uint256"}, {Name: "indexRemainder", Type: "uint256"},
	{Name: "rate", Type: "uint256"}, {Name: "idle", Type: "uint256"}, {Name: "funded", Type: "uint256"}, {Name: "paid", Type: "uint256"},
}

// Continuous observations are explicitly mode-tagged and contain no synthetic Root epochs.
// Every read and runtime check uses the same canonical block hash as the legacy observer.
func observeContinuousHolders(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, markets map[string]MarketDiscovery, roots map[string]string, distributor string, code []byte) (ObservationBatch, error) {
	fail := func(e error) (ObservationBatch, error) { return ObservationBatch{}, e }
	batch := ObservationBatch{Scope: HolderObservationScope, ChainID: m.ChainID, BlockNumber: block.Number, BlockHash: block.Hash, Observations: []StateObservation{}}
	pinned := false
	for _, c := range m.Contracts {
		if c.Module == "HolderRewardsDistributorV1" && c.Address == distributor && c.RuntimeCodeHash == Hash(code) {
			pinned = true
		}
	}
	if !pinned {
		return fail(errors.New("continuous Holder runtime mismatch"))
	}
	read := businessReader(ctx, rpc, block)
	single := func(addr, sig, args, typ string) (string, error) {
		v, e := read(addr, sig, args, []events.Input{{Name: "value", Type: typ}})
		if e != nil {
			return "", e
		}
		return v["value"].(string), nil
	}
	mode, e := single(distributor, "rewardMode()", "", "bytes32")
	if e != nil {
		return fail(e)
	}
	if !SupportedContinuousHolderMode(mode) {
		return fail(errors.New("unknown continuous Holder mode"))
	}
	duration, e := single(distributor, "STREAM_DURATION()", "", "uint256")
	if e != nil {
		return fail(e)
	}
	if duration != "86400" {
		return fail(errors.New("unexpected continuous Holder duration"))
	}
	number := func(s string) *big.Int { n, _ := new(big.Int).SetString(s, 10); return n }
	ids := map[string]bool{}
	for id, market := range markets {
		if market.State["creatorFeesToHolders"] == true {
			ids[id] = true
		}
	}
	sums := map[string]*big.Int{}
	for _, id := range sortedSet(ids) {
		discovered := markets[id]
		token, ok := discovered.State["memeToken"].(string)
		if !ok || !hex20.MatchString(token) || token == zero20 {
			return fail(errors.New("invalid continuous Holder token"))
		}
		quote, ok := discovered.State["quoteAsset"].(string)
		if !ok || !hex20.MatchString(quote) || quote == token {
			return fail(errors.New("invalid continuous Holder quote"))
		}
		tc, e := rpc.CodeAt(ctx, token, block.Hash)
		if e != nil {
			return fail(e)
		}
		pinned = false
		for _, c := range discovered.Contracts {
			if c.Module == "TickerMemeTokenV1" && c.Address == token && len(tc) > 0 && c.RuntimeCodeHash == Hash(tc) {
				pinned = true
			}
		}
		if !pinned {
			return fail(errors.New("continuous Holder token runtime mismatch"))
		}
		td, e := single(token, "treasuryDistributor()", "", "address")
		if e != nil {
			return fail(e)
		}
		if td != distributor {
			return fail(errors.New("continuous Holder token binding mismatch"))
		}
		v, e := read(distributor, "marketState(bytes32)", id[2:], continuousMarketFields)
		if e != nil {
			return fail(e)
		}
		if v["token"] != token || v["quote"] != quote || v["vault"] != roots["ProtocolFeeVault"] {
			return fail(errors.New("continuous Holder market binding mismatch"))
		}
		funded, paid := number(v["funded"].(string)), number(v["paid"].(string))
		if paid.Cmp(funded) > 0 {
			return fail(errors.New("continuous Holder paid exceeds funding"))
		}
		if sums[quote] == nil {
			sums[quote] = new(big.Int)
		}
		sums[quote].Add(sums[quote], new(big.Int).Sub(funded, paid))
		release, e := read(distributor, "releaseState(bytes32)", id[2:], []events.Input{{Name: "unreleased", Type: "uint256"}, {Name: "idleQuote", Type: "uint256"}, {Name: "nextEnd", Type: "uint64"}, {Name: "activeStreams", Type: "uint256"}})
		if e != nil {
			return fail(e)
		}
		last, e := single(distributor, "lastFundingAt(bytes32)", id[2:], "uint64")
		if e != nil {
			return fail(e)
		}
		if mode == Hash([]byte(DualAssetContinuousHolderMode)) {
			memeState, err := read(distributor, "memeMarketState(bytes32)", id[2:], continuousMarketFields)
			if err != nil {
				return fail(err)
			}
			if memeState["token"] != token || memeState["quote"] != token || memeState["vault"] != roots["ProtocolFeeVault"] || memeState["supply"] != v["supply"] {
				return fail(errors.New("dual Holder binding or supply mismatch"))
			}
			mf, mp := number(memeState["funded"].(string)), number(memeState["paid"].(string))
			if mp.Cmp(mf) > 0 {
				return fail(errors.New("dual Holder Meme paid exceeds funding"))
			}
			if sums[token] == nil {
				sums[token] = new(big.Int)
			}
			sums[token].Add(sums[token], new(big.Int).Sub(mf, mp))
			v["memeRewards"] = memeState
		}
		v["marketId"] = id
		v["rewardMode"] = "continuous-24h"
		v["rewardModeHash"] = mode
		v["treasuryDistributor"] = distributor
		v["treasuryRuntimeCodeHash"] = Hash(code)
		v["streamDuration"] = duration
		v["releaseState"] = release
		v["lastFundingAt"] = last
		v["fullReconciliation"] = false
		batch.Observations = append(batch.Observations, StateObservation{Kind: "holderMarket", Key: id, Value: v})
	}
	assets := map[string]bool{}
	for asset := range sums {
		assets[asset] = true
	}
	for _, asset := range sortedSet(assets) {
		liability, e := single(distributor, "totalLiability(address)", addressArgument(asset), "uint256")
		if e != nil {
			return fail(e)
		}
		var balance string
		if asset == zero20 {
			native, ok := rpc.(interface {
				BalanceAt(context.Context, string, string) (string, error)
			})
			if !ok {
				return fail(errors.New("continuous native balance observer required"))
			}
			balance, e = native.BalanceAt(ctx, distributor, block.Hash)
		} else {
			balance, e = single(asset, "balanceOf(address)", addressArgument(distributor), "uint256")
		}
		if e != nil {
			return fail(e)
		}
		n, ok := new(big.Int).SetString(balance, 10)
		if !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != balance {
			return fail(errors.New("invalid continuous Holder balance"))
		}
		batch.Observations = append(batch.Observations, StateObservation{Kind: "treasurySolvency", Key: distributor + ":" + asset, Value: map[string]any{"rewardMode": "continuous-24h", "treasuryDistributor": distributor, "asset": asset, "totalQuoteLiability": liability, "totalServiceLiability": "0", "requiredBalance": liability, "balance": balance, "knownHolderMarketOutstanding": sums[asset].String(), "fullReconciliation": false, "checks": map[string]bool{"balanceCoversLiabilities": n.Cmp(number(liability)) >= 0, "knownHolderSumEqualsQuoteLiability": sums[asset].Cmp(number(liability)) == 0}}})
	}
	batch.Expected = len(batch.Observations)
	end, e := rpc.Header(ctx, block.Number)
	if e != nil {
		return fail(e)
	}
	if end.Hash != block.Hash {
		return fail(errors.New("continuous Holder observation block changed"))
	}
	return batch, nil
}
