package settlement

import (
	"encoding/json"
	"testing"
	"tickergarden/backend/internal/chainrpc"
)

// Synthetic creator-only full evidence. This tests replay composition, not a
// deployed protocol transaction. Real protocol joint acceptance remains separate.
func executionFixture(t *testing.T) (IntentRecord, ConversionPreview, ReceiptGaugeStorage) {
	t.Helper()
	in, _, o := receiptEventFixture(t)
	p, _, _, state := creatorStorageFixture(t)
	p.Candidate.Plan.Batches[0].Items = p.Candidate.Plan.Batches[0].Items[:1]
	in.Intent.Call.Data, _ = conversionData(p.Candidate.Plan.Batches[0])
	o = matchingEvents(in, p, o)
	raw, _ := json.Marshal(o)
	r := ReceiptRecord{Sequence: 1, Digest: receiptDigest(raw), Observation: o}
	m, e := matchReceiptEvents(in, p, o)
	if e != nil {
		t.Fatal(e)
	}
	m.ReceiptSequence = r.Sequence
	m.ReceiptDigest = r.Digest
	var layout feeVaultLayout
	_ = json.Unmarshal(feeVaultStorageJSON, &layout)
	for _, v := range []struct{ asset, before, after string }{{p.Candidate.State.MemeToken, "64", "63"}, {p.Candidate.State.QuoteAsset, "3e8", "44c"}} {
		for _, bucket := range []int{-1, 0} {
			root := layout.TotalSlot
			var b *uint8
			if bucket >= 0 {
				root = layout.BucketSlot
				n := uint8(bucket)
				b = &n
			}
			slot, err := liabilityStorageSlot(root, m.MarketID, v.asset, b)
			if err != nil {
				t.Fatal(err)
			}
			state.Prestate[p.To].Storage[slot] = "0x" + eventWord(v.before)
			state.Diff.Pre[p.To].Storage[slot] = "0x" + eventWord(v.before)
			state.Diff.Post[p.To].Storage[slot] = "0x" + eventWord(v.after)
		}
	}
	tr := chainrpc.CallTrace{Type: "CALL", From: in.Intent.Call.From, To: p.To, Input: in.Intent.Call.Data, Value: in.Intent.Call.Value, Output: "0x" + eventWord("1") + eventWord("64")}
	read := func(asset, value string) chainrpc.CallTrace {
		return chainrpc.CallTrace{Type: "STATICCALL", From: p.To, To: asset, Input: traceSelector("balanceOf(address)") + eventWord(p.To), Output: "0x" + eventWord(value)}
	}
	for i := 0; i < 2; i++ {
		tr.Calls = append(tr.Calls, read(p.Candidate.State.MemeToken, "64"), read(p.Candidate.State.QuoteAsset, "3e8"))
	}
	b := p.Candidate.Plan.Batches[0]
	tr.Calls = append(tr.Calls, chainrpc.CallTrace{Type: "CALL", From: p.To, To: p.Route.Hook, Value: "0x0", Input: traceSelector("convertRewards(bytes32,uint256,uint256,uint256)") + eventWord(b.MarketID) + eventWord("3") + eventWord("63") + eventWord("64"), Output: "0x" + eventWord("1") + eventWord("64")})
	for i := 0; i < 2; i++ {
		tr.Calls = append(tr.Calls, read(p.Candidate.State.MemeToken, "63"), read(p.Candidate.State.QuoteAsset, "44c"))
	}
	calls, e := matchTraceAccounting(p, m, tr)
	if e != nil {
		t.Fatal("calls", e)
	}
	creator, e := matchCreatorStorage(p, m, calls, state)
	if e != nil {
		t.Fatal("creator", e)
	}
	liabilities, e := matchLiabilityStorage(p, m, state)
	if e != nil {
		t.Fatal("liabilities", e)
	}
	timestamp, _ := o.Head.Time()
	gauge, e := matchGaugeStorage(p, m, calls, state, timestamp)
	if e != nil {
		t.Fatal("gauge", e)
	}
	activation, e := matchGaugeActivation(p, state, gauge, timestamp)
	if e != nil {
		t.Fatal("activation", e)
	}
	remainders, e := matchGaugeRemainders(p, state, gauge, tr)
	if e != nil {
		t.Fatal("remainders", e)
	}
	balances, e := matchAssetBalances(p, m, calls, creator, liabilities, tr, state)
	if e != nil {
		t.Fatal("balances", e)
	}
	ev := ReceiptGaugeStorage{Block: o.Head, Evidence: ReceiptLiabilityStorage{Evidence: ReceiptCreatorStorage{Evidence: ReceiptAccounting{Evidence: ReceiptTrace{Receipt: r, Events: m, Trace: tr}, Accounting: calls}, State: state, CreatorStorage: creator}, Liabilities: liabilities}, Gauge: gauge, Activation: activation, Remainders: remainders, Balances: balances}
	return in, p, ev
}

func TestExecutionEvidenceReplay(t *testing.T) {
	in, p, ev := executionFixture(t)
	if e := replayExecutionEvidence(in, p, ev); e != nil {
		t.Fatal(e)
	}
	raw, e := json.Marshal(ev)
	if e != nil {
		t.Fatal(e)
	}
	var restored ReceiptGaugeStorage
	if json.Unmarshal(raw, &restored) != nil || replayExecutionEvidence(in, p, restored) != nil {
		t.Fatal("round trip")
	}
	for _, mode := range []string{"receipt-digest", "receipt-sequence", "block-time", "block-hash", "intent", "trace", "state", "creator", "liabilities", "balances", "gauge", "activation", "remainders"} {
		t.Run(mode, func(t *testing.T) {
			in, p, ev := executionFixture(t)
			switch mode {
			case "receipt-digest":
				ev.Evidence.Evidence.Evidence.Evidence.Receipt.Digest = "bad"
			case "receipt-sequence":
				ev.Evidence.Evidence.Evidence.Evidence.Receipt.Sequence = 0
			case "block-time":
				ev.Block.Timestamp = "0x1"
			case "block-hash":
				ev.Block.Hash = "0x00"
			case "intent":
				in.Intent.Call.Data = "0x00"
			case "trace":
				ev.Evidence.Evidence.Evidence.Evidence.Trace.Calls[0].Output = "0x" + eventWord("65")
			case "state":
				a := ev.Evidence.Evidence.State.Prestate[p.To]
				a.Storage = map[string]string{}
				ev.Evidence.Evidence.State.Prestate[p.To] = a
			case "creator":
				ev.Evidence.Evidence.CreatorStorage.AllInputsObserved = false
			case "liabilities":
				ev.Evidence.Liabilities.TotalsMatched = false
			case "balances":
				ev.Balances.Assets[0].After = "100"
			case "gauge":
				ev.Gauge.PositionsMatched = true
			case "activation":
				ev.Activation.WheelMatched = true
			case "remainders":
				ev.Remainders.Matched = true
			}
			if replayExecutionEvidence(in, p, ev) == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}
