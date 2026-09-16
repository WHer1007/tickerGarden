package deployment

import (
	"context"
	"errors"
	"math/big"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

type ConversionBalanceObserver interface {
	BindingObserver
	BalanceAt(context.Context, string, string) (string, error)
}
type ConversionAssetCoverage struct {
	Asset          string `json:"asset"`
	Balance        string `json:"balance"`
	TotalLiability string `json:"totalLiability"`
	Surplus        string `json:"surplus"`
}

// ObserveConversionCoverage compares the two market assets against FeeVault's
// own global liabilities. This is not independent liability reconciliation.
func ObserveConversionCoverage(ctx context.Context, rpc ConversionBalanceObserver, m Manifest, b chainrpc.Header, id string) ([]ConversionAssetCoverage, error) {
	fail := func() ([]ConversionAssetCoverage, error) {
		return nil, errors.New("reward conversion asset coverage unavailable or inconsistent")
	}
	stamp, e := b.Time()
	now := time.Now().Unix()
	if rpc == nil || e != nil || stamp > uint64(now+5) || now-int64(stamp) > 120 || !hex32.MatchString(id) || id == zero32 {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if _, e := VerifyCoreBindings(ctx, rpc, m, b); e != nil {
		return fail()
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		if c.Module == "MarketRegistryV1" || c.Module == "ProtocolFeeVault" {
			roots[c.Module] = c.Address
		}
	}
	registry, vault := roots["MarketRegistryV1"], roots["ProtocolFeeVault"]
	read := businessReader(ctx, rpc, b)
	scalar := func(target, sig, args, typ string) (string, error) {
		v, e := read(target, sig, args, []events.Input{{Name: "value", Type: typ}})
		if e != nil {
			return "", e
		}
		return v["value"].(string), nil
	}
	if v, e := scalar(vault, "marketRegistry()", "", "address"); e != nil || v != registry {
		return fail()
	}
	market, e := read(registry, "market(bytes32)", id[2:], marketFields)
	if e != nil || validateMarketState(market) != nil || market["launchPhase"] != "1" {
		return fail()
	}
	meme, quote := market["memeToken"].(string), market["quoteAsset"].(string)
	if v, e := scalar(registry, "marketIdByToken(address)", addressArgument(meme), "bytes32"); e != nil || v != id {
		return fail()
	}
	if meme == quote {
		return fail()
	}
	manifested := false
	for _, c := range m.Contracts {
		if c.Module == "TickerMemeTokenV1" && c.Address == meme {
			manifested = true
		}
	}
	if !manifested {
		return fail()
	}
	rows := make([]ConversionAssetCoverage, 0, 2)
	for _, asset := range []string{meme, quote} {
		liability, e := scalar(vault, "totalLiability(address)", addressArgument(asset), "uint256")
		if e != nil {
			return fail()
		}
		var balance string
		if asset == zero20 {
			balance, e = rpc.BalanceAt(ctx, vault, b.Hash)
		} else {
			balance, e = scalar(asset, "balanceOf(address)", addressArgument(vault), "uint256")
		}
		if e != nil {
			return fail()
		}
		if len(balance) > 78 {
			return fail()
		}
		available, ok := new(big.Int).SetString(balance, 10)
		if !ok || available.Sign() < 0 || available.BitLen() > 256 || available.String() != balance {
			return fail()
		}
		required, ok := new(big.Int).SetString(liability, 10)
		if !ok || available.Cmp(required) < 0 {
			return fail()
		}
		rows = append(rows, ConversionAssetCoverage{Asset: asset, Balance: balance, TotalLiability: liability, Surplus: new(big.Int).Sub(available, required).String()})
	}
	last, e := rpc.Header(ctx, b.Number)
	if e != nil || last != b || time.Now().Unix()-int64(stamp) > 120 {
		return fail()
	}
	return rows, nil
}
