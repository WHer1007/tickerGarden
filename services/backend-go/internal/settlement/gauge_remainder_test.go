package settlement

import (
	"encoding/json"
	"math/big"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

func remainderCall(gauge, manager, market, signature, value string) chainrpc.CallTrace {
	n, _ := amount(value)
	return chainrpc.CallTrace{Type: "STATICCALL", From: gauge, To: manager, Input: traceSelector(signature) + eventWord(market), Output: "0x" + eventWord(n.Text(16))}
}
func gaugeRemainderFixture(t *testing.T, reserve bool) (ConversionPreview, chainrpc.TransactionStateTrace, GaugeStorageAccounting, chainrpc.CallTrace, gaugeStorageLayout) {
	t.Helper()
	c := gaugePositionVectors(t)[0]
	p, m, calls, state := gaugeStorageFixture(t, c)
	participants, e := matchGaugeStorage(p, m, calls, state, c.Timestamp)
	if e != nil {
		t.Fatal(e)
	}
	var l gaugeStorageLayout
	_ = json.Unmarshal(gaugeStorageJSON, &l)
	g := p.Candidate.State.Gauge
	manager := "0x" + strings.Repeat("9", 40)
	epochBefore := "1"
	if reserve {
		epochBefore = "0"
	}
	activationPutWords(t, state, g, l.Cohort, []string{epochBefore}, []string{"1"})
	epochCall := remainderCall(g, manager, m.MarketID, "rewardCohortEpoch(bytes32)", "1")
	consume := chainrpc.CallTrace{Type: "CALL", From: p.To, To: g, Input: traceSelector("consumeForConversion(address,uint256)") + eventWord(m.Items[0].User) + eventWord("5"), Value: "0x0", Calls: []chainrpc.CallTrace{epochCall}}
	if !reserve {
		consume.Calls = append(consume.Calls, remainderCall(g, manager, m.MarketID, "rewardEligibleActiveStock(bytes32)", "100"))
	}
	trace := chainrpc.CallTrace{Type: "CALL", To: p.To, Calls: []chainrpc.CallTrace{consume}}
	if reserve {
		precision := gaugePrecision()
		half := new(big.Int).Div(new(big.Int).Set(precision), big.NewInt(2))
		quarter := new(big.Int).Div(new(big.Int).Set(precision), big.NewInt(4))
		globalQuote := new(big.Int).Add(new(big.Int).Mul(precision, big.NewInt(2)), half)
		slot, _ := gaugeSlot(l.Rewards, 1)
		activationPutWords(t, state, g, slot, []string{globalQuote.String()}, []string{"0"})
		slot, _ = gaugeSlot(l.Rewards, 3)
		activationPutWords(t, state, g, slot, []string{quarter.String()}, []string{"0"})
		activationPutWords(t, state, g, l.Precision, []string{half.String(), quarter.String()}, []string{"0", half.String()})
		activationPutWords(t, state, g, l.DeferredQuote, []string{"10"}, []string{"13"})
		activationPutWords(t, state, g, l.DeferredMeme, []string{"20"}, []string{"20"})
	}
	return p, state, participants, trace, l
}
func TestGaugeRemainderReserveAndNoReserve(t *testing.T) {
	for _, reserve := range []bool{true, false} {
		p, state, participants, trace, _ := gaugeRemainderFixture(t, reserve)
		out, e := matchGaugeRemainders(p, state, participants, trace)
		if e != nil || !out.Matched || out.Reads[0].Reserved != reserve {
			t.Fatal(out, e)
		}
		if reserve && (out.Assets[0].DeferredIncrease != "3" || out.Assets[1].DeferredIncrease != "0") {
			t.Fatal(out)
		}
		if !reserve && (out.Assets[0].IndexBefore != "" || out.Assets[0].DeferredBefore != "") {
			t.Fatal("invented untouched values", out)
		}
	}
}
func TestGaugeRemainderRepeatedEmptyCohort(t *testing.T) {
	p, state, participants, trace, _ := gaugeRemainderFixture(t, true)
	second := participants.Items[0]
	second.User = "0x" + strings.Repeat("c", 40)
	participants.Items = append(participants.Items, second)
	c := trace.Calls[0]
	c.Input = traceSelector("consumeForConversion(address,uint256)") + eventWord(second.User) + eventWord("5")
	c.Calls = append([]chainrpc.CallTrace{}, c.Calls...)
	c.Calls = append(c.Calls, remainderCall(p.Candidate.State.Gauge, "0x"+strings.Repeat("9", 40), p.Candidate.State.MarketID, "rewardEligibleActiveStock(bytes32)", "0"))
	trace.Calls = append(trace.Calls, c)
	out, e := matchGaugeRemainders(p, state, participants, trace)
	if e != nil || len(out.Reads) != 2 || !out.Reads[1].Reserved || out.Assets[0].DeferredIncrease != "3" {
		t.Fatal(out, e)
	}
}
func TestGaugeRemainderInvalidEvidence(t *testing.T) {
	for _, mode := range []string{"missing-epoch", "wrong-target", "wrong-market", "nonstatic", "extra-read", "wrong-short-circuit", "cohort-post", "missing-index", "precision", "payout", "overflow", "extra-mutation", "accumulator"} {
		t.Run(mode, func(t *testing.T) {
			p, state, participants, trace, l := gaugeRemainderFixture(t, true)
			g := p.Candidate.State.Gauge
			post := func(base string, v string) {
				slot, _ := gaugeSlot(base, 0)
				state.Diff.Post[g].Storage[slot] = "0x" + eventWord(v)
			}
			switch mode {
			case "missing-epoch":
				trace.Calls[0].Calls = nil
			case "wrong-target":
				trace.Calls[0].Calls[0].To = p.To
			case "wrong-market":
				trace.Calls[0].Calls[0].Input = traceSelector("rewardCohortEpoch(bytes32)") + eventWord("1")
			case "nonstatic":
				trace.Calls[0].Calls[0].Type = "CALL"
			case "extra-read":
				trace.Calls[0].Calls = append(trace.Calls[0].Calls, trace.Calls[0].Calls[0])
			case "wrong-short-circuit":
				trace.Calls[0].Calls = append(trace.Calls[0].Calls, remainderCall(g, "0x"+strings.Repeat("9", 40), p.Candidate.State.MarketID, "rewardEligibleActiveStock(bytes32)", "100"))
			case "cohort-post":
				post(l.Cohort, "2")
			case "missing-index":
				slot, _ := gaugeSlot(l.Rewards, 1)
				delete(state.Prestate[g].Storage, slot)
			case "precision":
				post(l.Precision, "1")
			case "payout":
				post(l.DeferredQuote, "e")
			case "overflow":
				slot, _ := gaugeSlot(l.DeferredQuote, 0)
				state.Prestate[g].Storage[slot] = "0x" + strings.Repeat("f", 64)
				state.Diff.Pre[g].Storage[slot] = state.Prestate[g].Storage[slot]
			case "extra-mutation":
				trace.Calls = append(trace.Calls, chainrpc.CallTrace{Type: "CALL", From: p.To, To: g, Input: traceSelector("flushDeferredForfeiture()")})
			case "accumulator":
				post(l.Rewards, "1")
			}
			if _, e := matchGaugeRemainders(p, state, participants, trace); e == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}

func TestGaugeRemainderReserveAfterEarlierNoop(t *testing.T) {
	p, state, participants, trace, l := gaugeRemainderFixture(t, true)
	g := p.Candidate.State.Gauge
	manager := "0x" + strings.Repeat("9", 40)
	activationPutWords(t, state, g, l.Cohort, []string{"1"}, []string{"2"})
	first := trace.Calls[0]
	first.Calls = append([]chainrpc.CallTrace{}, first.Calls...)
	first.Calls = append(first.Calls, remainderCall(g, manager, p.Candidate.State.MarketID, "rewardEligibleActiveStock(bytes32)", "100"))
	second := trace.Calls[0]
	second.Calls = []chainrpc.CallTrace{remainderCall(g, manager, p.Candidate.State.MarketID, "rewardCohortEpoch(bytes32)", "2")}
	item := participants.Items[0]
	item.User = "0x" + strings.Repeat("c", 40)
	participants.Items = append(participants.Items, item)
	second.Input = traceSelector("consumeForConversion(address,uint256)") + eventWord(item.User) + eventWord("5")
	trace.Calls = []chainrpc.CallTrace{first, second}
	out, e := matchGaugeRemainders(p, state, participants, trace)
	if e != nil || out.Reads[0].Reserved || !out.Reads[1].Reserved || out.CohortAfter != "2" || out.Assets[0].DeferredIncrease != "3" {
		t.Fatal(out, e)
	}
}
func TestGaugeNoReserveRejectsRemainderMutation(t *testing.T) {
	p, state, participants, trace, l := gaugeRemainderFixture(t, false)
	slot, _ := gaugeSlot(l.Rewards, 1)
	state.Diff.Post[p.Candidate.State.Gauge].Storage[slot] = "0x" + eventWord("1")
	if _, e := matchGaugeRemainders(p, state, participants, trace); e == nil {
		t.Fatal("no-reserve mutation accepted")
	}
}
