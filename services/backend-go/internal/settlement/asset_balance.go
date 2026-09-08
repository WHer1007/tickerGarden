package settlement

import (
	"math/big"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

type AssetBalanceEvidence struct {
	Asset           string `json:"asset"`
	Source          string `json:"source"`
	Before          string `json:"before"`
	After           string `json:"after"`
	LiabilityBefore string `json:"liabilityBefore"`
	LiabilityAfter  string `json:"liabilityAfter"`
	ReadsBefore     int    `json:"readsBefore"`
	ReadsAfter      int    `json:"readsAfter"`
}
type AssetBalanceAccounting struct {
	Assets          []AssetBalanceEvidence `json:"assets"`
	DeltasMatched   bool                   `json:"deltasMatched"`
	CoverageMatched bool                   `json:"coverageMatched"`
}

// matchAssetBalances checks the same ERC20 observable balances used by the
// pinned FeeVault, and native balances from prestate/diff. It is not a token
// storage-layout proof and does not infer liquidity or off-chain asset backing.
func matchAssetBalances(p ConversionPreview, event ReceiptEventMatch, calls TraceAccounting, creators CreatorStorageAccounting, liabilities LiabilityStorageAccounting, trace chainrpc.CallTrace, state chainrpc.TransactionStateTrace) (AssetBalanceAccounting, error) {
	fail := func() (AssetBalanceAccounting, error) { return AssetBalanceAccounting{}, ErrIntent }
	if !creators.AllInputsObserved || !creators.AllocationFormulaMatched || !liabilities.TotalsMatched || !liabilities.BucketsMatched || p.To != p.Candidate.State.FeeVault || p.Candidate.State.MemeToken == p.Candidate.State.QuoteAsset {
		return fail()
	}
	a, ok := state.Prestate[p.To]
	if !ok || a.Code == nil {
		return fail()
	}
	if _, e := verifiedFeeVaultLayout(*a.Code, p.Candidate.State.FeeVaultRuntimeCodeHash); e != nil {
		return fail()
	}
	expectedAfter := [2]int{1, 1}
	count := 0
	add := func(refund, quote string) bool {
		r, e := amount(refund)
		q, qe := amount(quote)
		if e != nil || qe != nil {
			return false
		}
		if r.Sign() > 0 {
			expectedAfter[0]++
		}
		if q.Sign() > 0 {
			expectedAfter[1]++
		}
		count++
		return true
	}
	for _, item := range calls.GaugeItems {
		if !add(item.MemeRefund, item.QuoteReceived) {
			return fail()
		}
	}
	for _, item := range creators.Items {
		if !add(item.MemeRefund, item.QuoteReceived) {
			return fail()
		}
	}
	if count != len(event.Items) {
		return fail()
	}
	assets := [2]string{p.Candidate.State.MemeToken, p.Candidate.State.QuoteAsset}
	balances := [2][2][]string{}
	hookSeen := false
	balanceSelector := traceSelector("balanceOf(address)")
	convertSelector := traceSelector("convertRewards(bytes32,uint256,uint256,uint256)")
	for _, c := range trace.Calls {
		if c.To == p.Route.Hook && len(c.Input) >= 10 && c.Input[:10] == convertSelector {
			if hookSeen || c.Type != "CALL" || c.From != p.To || c.Error != "" {
				return fail()
			}
			hookSeen = true
			continue
		}
		if len(c.Input) < 10 || c.Input[:10] != balanceSelector {
			continue
		}
		asset := -1
		for i, v := range assets {
			if c.To == v {
				asset = i
			}
		}
		if asset < 0 {
			continue
		}
		if assets[asset] == "0x0000000000000000000000000000000000000000" || c.Type != "STATICCALL" || c.From != p.To || c.Error != "" || (c.Value != "" && c.Value != "0x0") {
			return fail()
		}
		args, e := decodeTraceArgs(c, []events.Input{{Name: "owner", Type: "address"}})
		if e != nil || args["owner"] != p.To {
			return fail()
		}
		values, e := decodeTraceOutput(c, []events.Input{{Name: "balance", Type: "uint256"}})
		if e != nil {
			return fail()
		}
		phase := 0
		if hookSeen {
			phase = 1
		}
		balances[asset][phase] = append(balances[asset][phase], values["balance"].(string))
	}
	if !hookSeen {
		return fail()
	}
	out := AssetBalanceAccounting{Assets: []AssetBalanceEvidence{}}
	for i, asset := range assets {
		item := AssetBalanceEvidence{Asset: asset, Source: "erc20_balanceOf_trace", ReadsBefore: len(balances[i][0]), ReadsAfter: len(balances[i][1])}
		if asset == "0x0000000000000000000000000000000000000000" {
			if i != 1 {
				return fail()
			}
			var e error
			item.Before, item.After, e = state.ContractBalanceTransition(p.To)
			if e != nil {
				return fail()
			}
			item.Source = "native_prestate_diff"
		} else {
			if !validAddress(asset) || item.ReadsBefore != 2 || item.ReadsAfter != expectedAfter[i] {
				return fail()
			}
			item.Before = balances[i][0][0]
			item.After = balances[i][1][0]
			for _, v := range balances[i][0] {
				if v != item.Before {
					return fail()
				}
			}
			for _, v := range balances[i][1] {
				if v != item.After {
					return fail()
				}
			}
		}
		before, e := amount(item.Before)
		after, ae := amount(item.After)
		if e != nil || ae != nil {
			return fail()
		}
		delta, e := amount(event.MemeSpent)
		if i == 1 {
			delta, e = amount(event.QuoteReceived)
		}
		if e != nil || delta.Sign() == 0 {
			return fail()
		}
		if i == 0 {
			delta.Neg(delta)
		}
		want := new(big.Int).Add(before, delta)
		if want.Sign() < 0 || want.BitLen() > 256 || want.Cmp(after) != 0 {
			return fail()
		}
		matched := false
		for _, l := range liabilities.Changes {
			if l.Asset != asset || l.Role != "all_markets_total" {
				continue
			}
			if matched || !l.ValuesObserved {
				return fail()
			}
			matched = true
			b, be := amount(l.Before)
			a, ae := amount(l.After)
			if be != nil || ae != nil || before.Cmp(b) < 0 || after.Cmp(a) < 0 {
				return fail()
			}
			item.LiabilityBefore = l.Before
			item.LiabilityAfter = l.After
		}
		if !matched {
			return fail()
		}
		out.Assets = append(out.Assets, item)
	}
	out.DeltasMatched = true
	out.CoverageMatched = true
	return out, nil
}
