package settlement

import (
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
)

func creatorStorageFixture(t *testing.T) (ConversionPreview, ReceiptEventMatch, TraceAccounting, chainrpc.TransactionStateTrace) {
	t.Helper()
	p, m, tr := accountingFixture(t)
	m.MarketID = p.Candidate.Plan.Batches[0].MarketID
	p.Candidate.State.FeeVault = p.To
	p.Candidate.Plan.Batches[0].Items[0].CreatorEpoch = 1
	m.Items[0].CreatorEpoch = 1
	tr.Calls = []chainrpc.CallTrace{tr.Calls[1], tr.Calls[2], tr.Calls[4]}
	calls, err := matchTraceAccounting(p, m, tr)
	if err != nil {
		t.Fatal(err)
	}
	var layout feeVaultLayout
	if json.Unmarshal(feeVaultStorageJSON, &layout) != nil {
		t.Fatal("layout")
	}
	code := layout.Runtime
	raw, err := hex.DecodeString(code[2:])
	if err != nil {
		t.Fatal(err)
	}
	p.Candidate.State.FeeVaultRuntimeCodeHash = crypto.Keccak256Hash(raw).Hex()
	before := map[string]string{}
	pre := map[string]string{}
	post := map[string]string{}
	for _, v := range []struct{ asset, a, b string }{{p.Candidate.State.MemeToken, "3", "2"}, {p.Candidate.State.QuoteAsset, "a", "6e"}} {
		slot, err := creatorLiabilitySlot(layout, m.MarketID, 1, v.asset)
		if err != nil {
			t.Fatal(err)
		}
		before[slot] = "0x" + eventWord(v.a)
		pre[slot] = before[slot]
		post[slot] = "0x" + eventWord(v.b)
	}
	state := chainrpc.TransactionStateTrace{Prestate: chainrpc.TraceState{p.To: {Code: &code, Storage: before}}, Diff: chainrpc.StateDiff{Pre: chainrpc.TraceState{p.To: {Storage: pre}}, Post: chainrpc.TraceState{p.To: {Storage: post}}}}
	return p, m, calls, state
}

func TestCreatorStoragePartialFill(t *testing.T) {
	p, m, calls, state := creatorStorageFixture(t)
	out, err := matchCreatorStorage(p, m, calls, state)
	if err != nil || !out.AllInputsObserved || !out.AllocationFormulaMatched || !out.CreatorLiabilitiesMatched || len(out.Items) != 1 {
		t.Fatal(out, err)
	}
	item := out.Items[0]
	if item.PulledMeme != "3" || item.MemeRefund != "2" || item.MemeBefore != "3" || item.MemeAfter != "2" || item.QuoteBefore != "10" || item.QuoteAfter != "110" {
		t.Fatal(item)
	}
	// The signed maximum is 5; using maximum-spent would incorrectly report 4.
	for _, mode := range []string{"missing-runtime-pin", "wrong-runtime", "changed-template", "missing-pre", "wrong-meme", "wrong-quote", "hook-total", "formula", "duplicate-epoch"} {
		t.Run(mode, func(t *testing.T) {
			p, m, calls, state := creatorStorageFixture(t)
			var layout feeVaultLayout
			_ = json.Unmarshal(feeVaultStorageJSON, &layout)
			meme, _ := creatorLiabilitySlot(layout, m.MarketID, 1, p.Candidate.State.MemeToken)
			quote, _ := creatorLiabilitySlot(layout, m.MarketID, 1, p.Candidate.State.QuoteAsset)
			switch mode {
			case "missing-runtime-pin":
				p.Candidate.State.FeeVaultRuntimeCodeHash = ""
			case "wrong-runtime":
				p.Candidate.State.FeeVaultRuntimeCodeHash = "0x" + strings.Repeat("1", 64)
			case "changed-template":
				raw, _ := hex.DecodeString((*state.Prestate[p.To].Code)[2:])
				raw[0] ^= 1
				code := "0x" + hex.EncodeToString(raw)
				a := state.Prestate[p.To]
				a.Code = &code
				state.Prestate[p.To] = a
				p.Candidate.State.FeeVaultRuntimeCodeHash = crypto.Keccak256Hash(raw).Hex()
			case "missing-pre":
				delete(state.Prestate[p.To].Storage, meme)
			case "wrong-meme":
				state.Diff.Post[p.To].Storage[meme] = "0x" + eventWord("1")
			case "wrong-quote":
				state.Diff.Post[p.To].Storage[quote] = "0x" + eventWord("6f")
			case "hook-total":
				calls.HookRequestedMeme = "10"
			case "formula":
				// Keep total spent and received and both Creator state deltas consistent,
				// but allocate the wrong share to the Creator (2/200 instead of 1/100).
				m.Items[0].MemeSpent = "2"
				m.Items[0].QuoteReceived = "200"
				m.Items[1].MemeSpent = "1"
				m.Items[1].QuoteReceived = "100"
				state.Diff.Post[p.To].Storage[meme] = "0x" + eventWord("1")
				state.Diff.Post[p.To].Storage[quote] = "0x" + eventWord("d2")
			case "duplicate-epoch":
				m.Items[1].CreatorEpoch = 1
			}
			if _, err := matchCreatorStorage(p, m, calls, state); err == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}

func TestFeeVaultLayoutImmutableBinding(t *testing.T) {
	var layout feeVaultLayout
	if json.Unmarshal(feeVaultStorageJSON, &layout) != nil || len(layout.Immutables) == 0 {
		t.Fatal("layout")
	}
	raw, _ := hex.DecodeString(layout.Runtime[2:])
	original := crypto.Keccak256Hash(raw).Hex()
	for _, r := range layout.Immutables {
		raw[r.Start+r.Length-1] = 42
	}
	code := "0x" + hex.EncodeToString(raw)
	if _, err := verifiedFeeVaultLayout(code, crypto.Keccak256Hash(raw).Hex()); err != nil {
		t.Fatal(err)
	}
	if _, err := verifiedFeeVaultLayout(code, original); err == nil {
		t.Fatal("immutable bytes not authenticated")
	}
}

func TestCreatorStorageAllocationVariants(t *testing.T) {
	for _, mode := range []string{"all-creators", "maximum-limited", "zero-share"} {
		t.Run(mode, func(t *testing.T) {
			p, m, calls, state := creatorStorageFixture(t)
			var layout feeVaultLayout
			_ = json.Unmarshal(feeVaultStorageJSON, &layout)
			set := func(epoch uint32, asset, before, after string) {
				slot, e := creatorLiabilitySlot(layout, m.MarketID, epoch, asset)
				if e != nil {
					t.Fatal(e)
				}
				state.Prestate[p.To].Storage[slot] = "0x" + eventWord(before)
				state.Diff.Pre[p.To].Storage[slot] = "0x" + eventWord(before)
				state.Diff.Post[p.To].Storage[slot] = "0x" + eventWord(after)
			}
			wantPull, wantRefund := "3", "2"
			switch mode {
			case "all-creators":
				m.Items[1].CreatorEpoch = 2
				calls.GaugeItems = nil
				set(2, p.Candidate.State.MemeToken, "6", "4")
				set(2, p.Candidate.State.QuoteAsset, "0", "c8")
				q, _ := creatorLiabilitySlot(layout, m.MarketID, 2, p.Candidate.State.QuoteAsset)
				delete(state.Diff.Pre[p.To].Storage, q) // geth omits zero pre-diff slots
			case "maximum-limited":
				set(1, p.Candidate.State.MemeToken, "a", "9")
				calls.HookRequestedMeme = "11"
				wantPull, wantRefund = "5", "4"
			case "zero-share":
				set(1, p.Candidate.State.MemeToken, "1", "1")
				m.Items[0].MemeSpent = "0"
				m.Items[0].QuoteReceived = "0"
				m.Items[1].MemeSpent = "1"
				m.Items[1].QuoteReceived = "100"
				m.MemeSpent = "1"
				m.QuoteReceived = "100"
				calls.HookRequestedMeme = "7"
				calls.GaugeItems[0].MemeSpent = "1"
				calls.GaugeItems[0].MemeRefund = "5"
				calls.GaugeItems[0].QuoteReceived = "100"
				state.Diff.Pre = chainrpc.TraceState{}
				state.Diff.Post = chainrpc.TraceState{}
				q, _ := creatorLiabilitySlot(layout, m.MarketID, 1, p.Candidate.State.QuoteAsset)
				delete(state.Prestate[p.To].Storage, q)
				wantPull, wantRefund = "1", "1"
			}
			out, e := matchCreatorStorage(p, m, calls, state)
			if e != nil || out.Items[0].PulledMeme != wantPull || out.Items[0].MemeRefund != wantRefund {
				t.Fatal(out, e)
			}
		})
	}
}

func TestCreatorSlotCastVector(t *testing.T) {
	// Independently generated with cast index bytes32 -> uint32 -> address.
	slot, e := creatorLiabilitySlot(feeVaultLayout{CreatorSlot: "19"}, "0x"+strings.Repeat("11", 32), 7, "0x"+strings.Repeat("22", 20))
	if e != nil || slot != "0x4c86de7cea439abd7ba8d735524ced4657623533dc5d6d9ed701a463de012d7e" {
		t.Fatal(slot, e)
	}
}

func TestCreatorZeroOutputRejectsQuoteChange(t *testing.T) {
	p, m, calls, state := creatorStorageFixture(t)
	var layout feeVaultLayout
	_ = json.Unmarshal(feeVaultStorageJSON, &layout)
	meme, _ := creatorLiabilitySlot(layout, m.MarketID, 1, p.Candidate.State.MemeToken)
	state.Prestate[p.To].Storage[meme] = "0x" + eventWord("1")
	state.Diff.Pre[p.To].Storage[meme] = "0x" + eventWord("1")
	state.Diff.Post[p.To].Storage[meme] = "0x" + eventWord("1")
	m.Items[0].MemeSpent = "0"
	m.Items[0].QuoteReceived = "0"
	m.Items[1].MemeSpent = "1"
	m.Items[1].QuoteReceived = "100"
	m.MemeSpent = "1"
	m.QuoteReceived = "100"
	calls.HookRequestedMeme = "7"
	// Retain the fixture's 100-unit Quote storage increase despite zero output.
	if _, e := matchCreatorStorage(p, m, calls, state); e == nil {
		t.Fatal("unassigned Quote credit accepted")
	}
}
