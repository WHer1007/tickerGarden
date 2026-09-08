package settlement

import (
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
)

func accountingFixture(t *testing.T) (ConversionPreview, ReceiptEventMatch, chainrpc.CallTrace) {
	_, p, _ := receiptEventFixture(t)
	p.Candidate.State.Gauge = "0x" + strings.Repeat("6", 40)
	p.Route.Hook = "0x" + strings.Repeat("7", 40)
	b := &p.Candidate.Plan.Batches[0]
	b.Items[0].CreatorEpoch = 0
	m := ReceiptEventMatch{MemeSpent: "3", QuoteReceived: "300", Items: []ExecutedItem{{User: b.Items[0].User, CreatorEpoch: 0, MaximumMeme: "5", MemeSpent: "1", QuoteReceived: "100"}, {User: b.Items[1].User, CreatorEpoch: 0, MaximumMeme: "7", MemeSpent: "2", QuoteReceived: "200"}}}
	call := func(to, sig, data, output string) chainrpc.CallTrace {
		return chainrpc.CallTrace{Type: "CALL", From: p.To, To: to, Value: "0x0", Input: traceSelector(sig) + data, Output: output}
	}
	a, buser := m.Items[0].User, m.Items[1].User
	tr := chainrpc.CallTrace{Calls: []chainrpc.CallTrace{
		call(p.Candidate.State.Gauge, "consumeForConversion(address,uint256)", eventWord(a)+eventWord("5"), "0x"+eventWord("3")),
		call(p.Candidate.State.Gauge, "consumeForConversion(address,uint256)", eventWord(buser)+eventWord("7"), "0x"+eventWord("6")),
		call(p.Route.Hook, "convertRewards(bytes32,uint256,uint256,uint256)", eventWord(b.MarketID)+eventWord("9")+eventWord("63")+eventWord("64"), "0x"+eventWord("3")+eventWord("12c")),
		call(p.Candidate.State.Gauge, "creditConversion(address,uint256,uint256)", eventWord(a)+eventWord("2")+eventWord("64"), "0x"),
		call(p.Candidate.State.Gauge, "creditConversion(address,uint256,uint256)", eventWord(buser)+eventWord("4")+eventWord("c8"), "0x"),
	}}
	return p, m, tr
}
func TestTraceAccountingGaugePartialFill(t *testing.T) {
	p, m, tr := accountingFixture(t)
	got, err := matchTraceAccounting(p, m, tr)
	if err != nil || !got.AllInputsObserved || !got.AllocationFormulaMatched || len(got.GaugeItems) != 2 || got.GaugeItems[0].PulledMeme != "3" || got.GaugeItems[0].MemeRefund != "2" || got.GaugeItems[1].MemeRefund != "4" {
		t.Fatal(got, err)
	}
	for _, mode := range []string{"target", "from", "error", "type", "missing", "duplicate", "order", "maximum", "overpull", "refund", "quote", "hook-total", "hook-output", "formula", "missing-gauge", "nested"} {
		t.Run(mode, func(t *testing.T) {
			p, m, tr := accountingFixture(t)
			switch mode {
			case "target":
				tr.Calls[0].To = p.Route.Hook
			case "from":
				tr.Calls[0].From = p.Candidate.State.Gauge
			case "error":
				tr.Calls[0].Error = "reverted"
			case "type":
				tr.Calls[0].Type = "DELEGATECALL"
			case "missing":
				tr.Calls = tr.Calls[:4]
			case "duplicate":
				tr.Calls = append(tr.Calls, tr.Calls[4])
			case "order":
				tr.Calls[0], tr.Calls[2] = tr.Calls[2], tr.Calls[0]
			case "maximum":
				tr.Calls[0].Input = traceSelector("consumeForConversion(address,uint256)") + eventWord(m.Items[0].User) + eventWord("6")
			case "overpull":
				tr.Calls[0].Output = "0x" + eventWord("6")
			case "refund":
				tr.Calls[3].Input = traceSelector("creditConversion(address,uint256,uint256)") + eventWord(m.Items[0].User) + eventWord("3") + eventWord("64")
			case "quote":
				tr.Calls[3].Input = traceSelector("creditConversion(address,uint256,uint256)") + eventWord(m.Items[0].User) + eventWord("2") + eventWord("65")
			case "hook-total":
				tr.Calls[2].Input = traceSelector("convertRewards(bytes32,uint256,uint256,uint256)") + eventWord(p.Candidate.Plan.Batches[0].MarketID) + eventWord("a") + eventWord("63") + eventWord("64")
			case "hook-output":
				tr.Calls[2].Output = "0x" + eventWord("4") + eventWord("12c")
			case "formula":
				m.Items[0].MemeSpent = "2"
				m.Items[0].QuoteReceived = "200"
				m.Items[1].MemeSpent = "1"
				m.Items[1].QuoteReceived = "100"
				tr.Calls[3].Input = traceSelector("creditConversion(address,uint256,uint256)") + eventWord(m.Items[0].User) + eventWord("1") + eventWord("c8")
				tr.Calls[4].Input = traceSelector("creditConversion(address,uint256,uint256)") + eventWord(m.Items[1].User) + eventWord("5") + eventWord("64")
			case "nested":
				tr.Calls[0].Calls = []chainrpc.CallTrace{tr.Calls[3]}
			case "missing-gauge":
				p.Candidate.State.Gauge = ""
			}
			if _, err := matchTraceAccounting(p, m, tr); err == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}
func TestTraceAccountingCreatorRemainsUnresolved(t *testing.T) {
	p, m, tr := accountingFixture(t)
	p.Candidate.Plan.Batches[0].Items[0].CreatorEpoch = 1
	m.Items[0].CreatorEpoch = 1
	tr.Calls = []chainrpc.CallTrace{tr.Calls[1], tr.Calls[2], tr.Calls[4]}
	got, err := matchTraceAccounting(p, m, tr)
	if err != nil || got.AllInputsObserved || got.AllocationFormulaMatched || len(got.UnresolvedCreators) != 1 || len(got.GaugeItems) != 1 {
		t.Fatal(got, err)
	}
}

func TestTraceAccountingCloneImplementationFrame(t *testing.T) {
	p, m, tr := accountingFixture(t)
	delegate := tr.Calls[0]
	delegate.Type = "DELEGATECALL"
	delegate.From = p.Candidate.State.Gauge
	delegate.To = "0x" + strings.Repeat("8", 40)
	tr.Calls[0].Calls = []chainrpc.CallTrace{delegate}
	if _, err := matchTraceAccounting(p, m, tr); err != nil {
		t.Fatal(err)
	}
}
