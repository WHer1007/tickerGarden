package settlement

import (
	"encoding/hex"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

type GaugeAccounting struct {
	User          string `json:"user"`
	PulledMeme    string `json:"pulledMeme"`
	MemeSpent     string `json:"memeSpent"`
	MemeRefund    string `json:"memeRefund"`
	QuoteReceived string `json:"quoteReceived"`
}
type TraceAccounting struct {
	HookRequestedMeme        string            `json:"hookRequestedMeme"`
	GaugeItems               []GaugeAccounting `json:"gaugeItems"`
	UnresolvedCreators       []ExecutedItem    `json:"unresolvedCreators"`
	AllInputsObserved        bool              `json:"allInputsObserved"`
	AllocationFormulaMatched bool              `json:"allocationFormulaMatched"`
}

func traceSelector(signature string) string {
	return "0x" + hex.EncodeToString(crypto.Keccak256([]byte(signature))[:4])
}
func decodeTraceArgs(call chainrpc.CallTrace, fields []events.Input) (map[string]any, error) {
	if len(call.Input) < 10 {
		return nil, ErrIntent
	}
	raw, err := hex.DecodeString(call.Input[10:])
	if err != nil {
		return nil, ErrIntent
	}
	return events.DecodeStatic(fields, raw)
}
func decodeTraceOutput(call chainrpc.CallTrace, fields []events.Input) (map[string]any, error) {
	if !strings.HasPrefix(call.Output, "0x") {
		return nil, ErrIntent
	}
	raw, err := hex.DecodeString(call.Output[2:])
	if err != nil {
		return nil, ErrIntent
	}
	return events.DecodeStatic(fields, raw)
}

// matchTraceAccounting checks explicit external calls and cumulative allocation
// arithmetic. It cannot prove internal storage writes or infer Creator pulls.
func matchTraceAccounting(p ConversionPreview, matched ReceiptEventMatch, trace chainrpc.CallTrace) (TraceAccounting, error) {
	fail := func() (TraceAccounting, error) { return TraceAccounting{}, ErrIntent }
	if p.Candidate.Plan == nil || len(p.Candidate.Plan.Batches) != 1 || len(matched.Items) == 0 {
		return fail()
	}
	b := p.Candidate.Plan.Batches[0]
	if len(b.Items) != len(matched.Items) {
		return fail()
	}
	out := TraceAccounting{GaugeItems: []GaugeAccounting{}, UnresolvedCreators: []ExecutedItem{}}
	var stakers []ExecutedItem
	for i, item := range matched.Items {
		if item.User != b.Items[i].User || item.CreatorEpoch != b.Items[i].CreatorEpoch || item.MaximumMeme != b.Items[i].MaximumMeme {
			return fail()
		}
		if item.CreatorEpoch == 0 {
			stakers = append(stakers, item)
		} else {
			out.UnresolvedCreators = append(out.UnresolvedCreators, item)
		}
	}
	if len(stakers) > 0 && !validAddress(p.Candidate.State.Gauge) {
		return fail()
	}
	consume := traceSelector("consumeForConversion(address,uint256)")
	credit := traceSelector("creditConversion(address,uint256,uint256)")
	convert := traceSelector("convertRewards(bytes32,uint256,uint256,uint256)")
	// The pinned FeeVault implementation issues these operations directly.
	// Do not silently ignore an extra FeeVault-origin operation hidden below
	// another call. Gauge clone DELEGATECALL implementation frames are not new
	// external accounting operations and remain allowed.
	var nestedOperation func([]chainrpc.CallTrace, int) bool
	nestedOperation = func(calls []chainrpc.CallTrace, depth int) bool {
		if depth > 64 {
			return true
		}
		for _, c := range calls {
			if c.Type == "CALL" && c.From == p.To && len(c.Input) >= 10 {
				selector := c.Input[:10]
				if selector == consume || selector == credit || selector == convert {
					return true
				}
			}
			if nestedOperation(c.Calls, depth+1) {
				return true
			}
		}
		return false
	}
	for _, c := range trace.Calls {
		if nestedOperation(c.Calls, 1) {
			return fail()
		}
	}
	pulled := []*big.Int{}
	consumes, credits := 0, 0
	hookSeen := false
	var total *big.Int
	for _, call := range trace.Calls {
		if len(call.Input) < 10 {
			continue
		}
		sel := call.Input[:10]
		if sel != consume && sel != credit && sel != convert {
			continue
		}
		if call.Type != "CALL" || call.From != p.To || call.Value != "0x0" || call.Error != "" {
			return fail()
		}
		switch sel {
		case consume:
			if hookSeen || consumes >= len(stakers) || call.To != p.Candidate.State.Gauge {
				return fail()
			}
			a, e := decodeTraceArgs(call, []events.Input{{Name: "user", Type: "address"}, {Name: "maximum", Type: "uint256"}})
			if e != nil {
				return fail()
			}
			item := stakers[consumes]
			if a["user"] != item.User || a["maximum"] != item.MaximumMeme {
				return fail()
			}
			result, e := decodeTraceOutput(call, []events.Input{{Name: "amount", Type: "uint256"}})
			if e != nil {
				return fail()
			}
			n, e := amount(result["amount"].(string))
			max, me := amount(item.MaximumMeme)
			used, ue := amount(item.MemeSpent)
			if e != nil || me != nil || ue != nil || n.Sign() == 0 || n.Cmp(max) > 0 || n.Cmp(used) < 0 {
				return fail()
			}
			pulled = append(pulled, n)
			consumes++
		case convert:
			if hookSeen || consumes != len(stakers) || call.To != p.Route.Hook {
				return fail()
			}
			a, e := decodeTraceArgs(call, []events.Input{{Name: "market", Type: "bytes32"}, {Name: "amount", Type: "uint256"}, {Name: "minimum", Type: "uint256"}, {Name: "deadline", Type: "uint256"}})
			if e != nil || a["market"] != b.MarketID || a["minimum"] != b.MinimumQuote {
				return fail()
			}
			d, e := amount(a["deadline"].(string))
			if e != nil || d.Cmp(big.NewInt(b.Deadline)) != 0 {
				return fail()
			}
			total, e = amount(a["amount"].(string))
			if e != nil || total.Sign() == 0 {
				return fail()
			}
			result, e := decodeTraceOutput(call, []events.Input{{Name: "spent", Type: "uint256"}, {Name: "received", Type: "uint256"}})
			if e != nil || result["spent"] != matched.MemeSpent || result["received"] != matched.QuoteReceived {
				return fail()
			}
			hookSeen = true
			out.HookRequestedMeme = total.String()
		case credit:
			if !hookSeen || credits >= len(stakers) || call.To != p.Candidate.State.Gauge || (call.Output != "" && call.Output != "0x") {
				return fail()
			}
			a, e := decodeTraceArgs(call, []events.Input{{Name: "user", Type: "address"}, {Name: "refund", Type: "uint256"}, {Name: "quote", Type: "uint256"}})
			item := stakers[credits]
			if e != nil || a["user"] != item.User || a["quote"] != item.QuoteReceived {
				return fail()
			}
			refund, e := amount(a["refund"].(string))
			used, ue := amount(item.MemeSpent)
			if e != nil || ue != nil || new(big.Int).Add(refund, used).Cmp(pulled[credits]) != 0 {
				return fail()
			}
			out.GaugeItems = append(out.GaugeItems, GaugeAccounting{User: item.User, PulledMeme: pulled[credits].String(), MemeSpent: item.MemeSpent, MemeRefund: refund.String(), QuoteReceived: item.QuoteReceived})
			credits++
		}
	}
	if !hookSeen || consumes != len(stakers) || credits != len(stakers) {
		return fail()
	}
	lower, upper := new(big.Int), new(big.Int)
	for _, n := range pulled {
		lower.Add(lower, n)
		upper.Add(upper, n)
	}
	for _, item := range out.UnresolvedCreators {
		used, e := amount(item.MemeSpent)
		max, me := amount(item.MaximumMeme)
		if e != nil || me != nil {
			return fail()
		}
		lower.Add(lower, used)
		upper.Add(upper, max)
	}
	spent, e := amount(matched.MemeSpent)
	received, re := amount(matched.QuoteReceived)
	if e != nil || re != nil || spent.Sign() == 0 || received.Sign() == 0 || total.Cmp(spent) < 0 || total.Cmp(lower) < 0 || total.Cmp(upper) > 0 {
		return fail()
	}
	if len(out.UnresolvedCreators) == 0 {
		cumulative, previousSpent, previousQuote := new(big.Int), new(big.Int), new(big.Int)
		for i, n := range pulled {
			cumulative.Add(cumulative, n)
			allocatedSpent := new(big.Int).Div(new(big.Int).Mul(cumulative, spent), total)
			allocatedQuote := new(big.Int).Div(new(big.Int).Mul(allocatedSpent, received), spent)
			if new(big.Int).Sub(allocatedSpent, previousSpent).String() != stakers[i].MemeSpent || new(big.Int).Sub(allocatedQuote, previousQuote).String() != stakers[i].QuoteReceived {
				return fail()
			}
			previousSpent, previousQuote = allocatedSpent, allocatedQuote
		}
		out.AllInputsObserved = true
		out.AllocationFormulaMatched = true
	}
	return out, nil
}
