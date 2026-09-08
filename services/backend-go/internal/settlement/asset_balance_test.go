package settlement

import (
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
)

func assetBalanceFixture(t *testing.T, native bool) (ConversionPreview, ReceiptEventMatch, TraceAccounting, CreatorStorageAccounting, LiabilityStorageAccounting, chainrpc.CallTrace, chainrpc.TransactionStateTrace) {
	t.Helper()
	p, m, state, _ := liabilityFixture(t)
	liabilities, e := matchLiabilityStorage(p, m, state)
	if e != nil {
		t.Fatal(e)
	}
	calls := TraceAccounting{GaugeItems: []GaugeAccounting{{User: m.Items[1].User, PulledMeme: "6", MemeSpent: "2", MemeRefund: "4", QuoteReceived: "200"}}}
	creators := CreatorStorageAccounting{AllInputsObserved: true, AllocationFormulaMatched: true, Items: []CreatorStorageItem{{User: m.Items[0].User, CreatorEpoch: 1, PulledMeme: "3", MemeSpent: "1", MemeRefund: "2", QuoteReceived: "100"}}}
	if native {
		old := p.Candidate.State.QuoteAsset
		p.Candidate.State.QuoteAsset = "0x0000000000000000000000000000000000000000"
		for i := range liabilities.Changes {
			if liabilities.Changes[i].Asset == old {
				liabilities.Changes[i].Asset = p.Candidate.State.QuoteAsset
			}
		}
		before, after := "0x3e8", "0x514"
		a := state.Prestate[p.To]
		a.Balance = &before
		state.Prestate[p.To] = a
		a = state.Diff.Pre[p.To]
		a.Balance = &before
		state.Diff.Pre[p.To] = a
		a = state.Diff.Post[p.To]
		a.Balance = &after
		state.Diff.Post[p.To] = a
	}
	read := func(asset, v string) chainrpc.CallTrace {
		return chainrpc.CallTrace{Type: "STATICCALL", From: p.To, To: asset, Input: traceSelector("balanceOf(address)") + eventWord(p.To), Output: "0x" + eventWord(v)}
	}
	trace := chainrpc.CallTrace{Type: "CALL", To: p.To}
	for i := 0; i < 2; i++ {
		trace.Calls = append(trace.Calls, read(p.Candidate.State.MemeToken, "64"))
		if !native {
			trace.Calls = append(trace.Calls, read(p.Candidate.State.QuoteAsset, "3e8"))
		}
	}
	trace.Calls = append(trace.Calls, chainrpc.CallTrace{Type: "CALL", From: p.To, To: p.Route.Hook, Input: traceSelector("convertRewards(bytes32,uint256,uint256,uint256)")})
	for i := 0; i < 3; i++ {
		trace.Calls = append(trace.Calls, read(p.Candidate.State.MemeToken, "61"))
		if !native {
			trace.Calls = append(trace.Calls, read(p.Candidate.State.QuoteAsset, "514"))
		}
	}
	return p, m, calls, creators, liabilities, trace, state
}
func TestAssetBalancesERC20AndNative(t *testing.T) {
	for _, native := range []bool{true, false} {
		p, m, calls, creators, l, trace, state := assetBalanceFixture(t, native)
		got, e := matchAssetBalances(p, m, calls, creators, l, trace, state)
		if e != nil || !got.DeltasMatched || !got.CoverageMatched || len(got.Assets) != 2 || got.Assets[0].Before != "100" || got.Assets[0].After != "97" || got.Assets[1].After != "1300" {
			t.Fatal(got, e)
		}
		if native && got.Assets[1].Source != "native_prestate_diff" {
			t.Fatal(got)
		}
	}
}
func TestAssetBalancesInvalidEvidence(t *testing.T) {
	for _, mode := range []string{"missing-read", "extra-read", "owner", "from", "target", "mutating", "reverted", "output", "unstable-before", "wrong-after", "underfunded", "missing-liability", "unobserved-liability", "duplicate-liability", "unverified-input", "hook", "native-missing", "native-wrong"} {
		t.Run(mode, func(t *testing.T) {
			native := strings.HasPrefix(mode, "native-")
			p, m, calls, creators, l, trace, state := assetBalanceFixture(t, native)
			switch mode {
			case "missing-read":
				trace.Calls = trace.Calls[1:]
			case "extra-read":
				trace.Calls = append([]chainrpc.CallTrace{trace.Calls[0]}, trace.Calls...)
			case "owner":
				trace.Calls[0].Input = traceSelector("balanceOf(address)") + eventWord(p.Route.Hook)
			case "from":
				trace.Calls[0].From = p.Route.Hook
			case "target":
				trace.Calls[0].To = p.Route.Hook
			case "mutating":
				trace.Calls[0].Type = "CALL"
			case "reverted":
				trace.Calls[0].Error = "reverted"
			case "output":
				trace.Calls[0].Output = "0x"
			case "unstable-before":
				trace.Calls[0].Output = "0x" + eventWord("65")
			case "wrong-after":
				trace.Calls[5].Output = "0x" + eventWord("60")
			case "underfunded":
				for i := range trace.Calls {
					c := &trace.Calls[i]
					if c.To == p.Candidate.State.MemeToken {
						v := "1"
						if i < 4 {
							v = "4"
						}
						c.Output = "0x" + eventWord(v)
					}
				}
			case "missing-liability":
				l.Changes = l.Changes[1:]
			case "unobserved-liability":
				l.Changes[0].ValuesObserved = false
			case "duplicate-liability":
				l.Changes = append(l.Changes, l.Changes[0])
			case "unverified-input":
				creators.AllInputsObserved = false
			case "hook":
				trace.Calls[4].To = p.To
			case "native-missing":
				a := state.Prestate[p.To]
				a.Balance = nil
				state.Prestate[p.To] = a
			case "native-wrong":
				value := "0x515"
				a := state.Diff.Post[p.To]
				a.Balance = &value
				state.Diff.Post[p.To] = a
			}
			if _, e := matchAssetBalances(p, m, calls, creators, l, trace, state); e == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}

func TestAssetBalanceZeroRefundReadCount(t *testing.T) {
	p, m, calls, creators, l, trace, state := assetBalanceFixture(t, false)
	calls.GaugeItems[0].MemeRefund = "0"
	calls.GaugeItems[0].PulledMeme = "2"
	// No MEME refund for this Staker means no corresponding _requireSolvent call.
	trace.Calls = append(trace.Calls[:9], trace.Calls[10:]...)
	got, e := matchAssetBalances(p, m, calls, creators, l, trace, state)
	if e != nil || got.Assets[0].ReadsAfter != 2 {
		t.Fatal(got, e)
	}
}

func TestAssetBalanceZeroQuoteShareReadCount(t *testing.T) {
	p, m, calls, creators, l, trace, state := assetBalanceFixture(t, false)
	creators.Items[0].MemeSpent = "0"
	creators.Items[0].MemeRefund = "3"
	creators.Items[0].QuoteReceived = "0"
	calls.GaugeItems[0].QuoteReceived = "300"
	m.Items[0].MemeSpent = "0"
	m.Items[0].QuoteReceived = "0"
	m.Items[1].QuoteReceived = "300"
	m.MemeSpent = "2"
	l.Changes[0].After = "98"
	l.Changes[0].Delta = "-2"
	for i := 5; i < len(trace.Calls); i++ {
		if trace.Calls[i].To == p.Candidate.State.MemeToken {
			trace.Calls[i].Output = "0x" + eventWord("62")
		}
	}
	trace.Calls = append(trace.Calls[:8], trace.Calls[9:]...)
	got, e := matchAssetBalances(p, m, calls, creators, l, trace, state)
	if e != nil || got.Assets[1].ReadsAfter != 2 {
		t.Fatal(got, e)
	}
}
