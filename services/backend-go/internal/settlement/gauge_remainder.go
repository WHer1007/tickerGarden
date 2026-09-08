package settlement

import (
	"encoding/hex"
	"math/big"
	"strings"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

type GaugeCohortRead struct {
	Epoch         string `json:"epoch"`
	EligibleStock string `json:"eligibleStock,omitempty"`
	Reserved      bool   `json:"reserved"`
}
type GaugeRemainderAsset struct {
	RewardIndex      int    `json:"rewardIndex"`
	IndexBefore      string `json:"indexBefore,omitempty"`
	IndexAfter       string `json:"indexAfter,omitempty"`
	PrecisionBefore  string `json:"precisionBefore,omitempty"`
	PrecisionAfter   string `json:"precisionAfter,omitempty"`
	DeferredIncrease string `json:"deferredIncrease"`
	DeferredBefore   string `json:"deferredBefore,omitempty"`
	DeferredAfter    string `json:"deferredAfter,omitempty"`
}
type GaugeRemainderAccounting struct {
	Matched      bool                  `json:"matched"`
	CohortBefore string                `json:"cohortBefore,omitempty"`
	CohortAfter  string                `json:"cohortAfter,omitempty"`
	Reads        []GaugeCohortRead     `json:"reads"`
	Assets       []GaugeRemainderAsset `json:"assets"`
}

func reserveGaugeRemainder(index, precision *big.Int) (*big.Int, *big.Int, error) {
	if index == nil || precision == nil || index.Sign() < 0 || index.BitLen() > 256 || precision.Sign() < 0 || precision.Cmp(gaugePrecision()) >= 0 {
		return nil, nil, ErrIntent
	}
	whole, remainder := new(big.Int), new(big.Int)
	whole.QuoRem(index, gaugePrecision(), remainder)
	remainder.Add(remainder, precision)
	whole.Add(whole, new(big.Int).Quo(remainder, gaugePrecision()))
	remainder.Mod(remainder, gaugePrecision())
	if whole.BitLen() > 256 {
		return nil, nil, ErrIntent
	}
	return whole, remainder, nil
}

func gaugeCohortReads(call chainrpc.CallTrace, gauge, manager, market string) ([]GaugeCohortRead, error) {
	epoch := traceSelector("rewardCohortEpoch(bytes32)")
	eligible := traceSelector("rewardEligibleActiveStock(bytes32)")
	var frames []chainrpc.CallTrace
	var walk func(chainrpc.CallTrace, int) error
	walk = func(c chainrpc.CallTrace, depth int) error {
		if depth > 64 {
			return ErrIntent
		}
		if c.From == gauge && len(c.Input) >= 10 && (c.Input[:10] == epoch || c.Input[:10] == eligible) {
			if c.Type != "STATICCALL" || c.To != manager || c.Error != "" || (c.Value != "" && c.Value != "0x0") {
				return ErrIntent
			}
			a, e := decodeTraceArgs(c, []events.Input{{Name: "market", Type: "bytes32"}})
			if e != nil || a["market"] != market {
				return ErrIntent
			}
			frames = append(frames, c)
		}
		for _, child := range c.Calls {
			if e := walk(child, depth+1); e != nil {
				return e
			}
		}
		return nil
	}
	if e := walk(call, 0); e != nil {
		return nil, e
	}
	if len(frames) < 1 || len(frames) > 2 || frames[0].Input[:10] != epoch {
		return nil, ErrIntent
	}
	values, e := decodeTraceOutput(frames[0], []events.Input{{Name: "epoch", Type: "uint256"}})
	if e != nil {
		return nil, ErrIntent
	}
	result := GaugeCohortRead{Epoch: values["epoch"].(string)}
	if len(frames) == 2 {
		if frames[1].Input[:10] != eligible {
			return nil, ErrIntent
		}
		values, e := decodeTraceOutput(frames[1], []events.Input{{Name: "weight", Type: "uint256"}})
		if e != nil {
			return nil, ErrIntent
		}
		result.EligibleStock = values["weight"].(string)
	}
	return []GaugeCohortRead{result}, nil
}

func matchGaugeRemainders(p ConversionPreview, state chainrpc.TransactionStateTrace, participants GaugeStorageAccounting, trace chainrpc.CallTrace) (GaugeRemainderAccounting, error) {
	fail := func() (GaugeRemainderAccounting, error) { return GaugeRemainderAccounting{}, ErrIntent }
	out := GaugeRemainderAccounting{Reads: []GaugeCohortRead{}, Assets: []GaugeRemainderAsset{}}
	if len(participants.Items) == 0 {
		return out, nil
	}
	if !participants.PositionsMatched {
		return fail()
	}
	layout, _, e := verifyGaugeStorageCode(p, state)
	if e != nil {
		return fail()
	}
	gauge := p.Candidate.State.Gauge
	clone, _ := hex.DecodeString(strings.TrimPrefix(*state.Prestate[gauge].Code, "0x"))
	manager := "0x" + hex.EncodeToString(clone[45+3*32+12:45+4*32])
	if !validAddress(manager) {
		return fail()
	}
	cohort, e := gaugeStorageWords(state, gauge, layout.Cohort, 1, false)
	if e != nil {
		return fail()
	}
	observed := cohort[0].String()
	out.CohortBefore = observed
	consume := traceSelector("consumeForConversion(address,uint256)")
	credit := traceSelector("creditConversion(address,uint256,uint256)")
	// During a conversion only the already matched top-level consume/credit
	// calls may mutate the Gauge. Extra settlements/credits would need replay.
	var allowed func(chainrpc.CallTrace, int) bool
	allowed = func(c chainrpc.CallTrace, depth int) bool {
		if depth > 64 {
			return false
		}
		if c.To == gauge && c.Type != "STATICCALL" {
			if depth != 1 || c.Type != "CALL" || c.From != p.To || len(c.Input) < 10 || (c.Input[:10] != consume && c.Input[:10] != credit) {
				return false
			}
		}
		for _, child := range c.Calls {
			if !allowed(child, depth+1) {
				return false
			}
		}
		return true
	}
	if !allowed(trace, 0) {
		return fail()
	}
	reserved := false
	for _, c := range trace.Calls {
		if c.To != gauge || len(c.Input) < 10 || c.Input[:10] != consume {
			continue
		}
		if len(out.Reads) >= len(participants.Items) {
			return fail()
		}
		r, e := gaugeCohortReads(c, gauge, manager, p.Candidate.State.MarketID)
		if e != nil {
			return fail()
		}
		reading := r[0]
		ended := reading.Epoch != observed
		if ended && reading.EligibleStock != "" || !ended && reading.EligibleStock == "" {
			return fail()
		}
		reading.Reserved = ended || reading.EligibleStock == "0"
		reserved = reserved || reading.Reserved
		observed = reading.Epoch
		out.Reads = append(out.Reads, reading)
	}
	if len(out.Reads) != len(participants.Items) {
		return fail()
	}
	after, e := gaugeStorageWords(state, gauge, layout.Cohort, 1, true)
	if e != nil || after[0].String() != observed {
		return fail()
	}
	out.CohortAfter = observed
	for i := 0; i < 2; i++ {
		accSlot, e := gaugeSlot(layout.Rewards, uint64(i*2))
		if e != nil {
			return fail()
		}
		if _, e := checkLiabilityDelta(state, gauge, accSlot, new(big.Int)); e != nil {
			return fail()
		}
		indexSlot, e := gaugeSlot(layout.Rewards, uint64(i*2+1))
		if e != nil {
			return fail()
		}
		precisionSlot, e := gaugeSlot(layout.Precision, uint64(i))
		if e != nil {
			return fail()
		}
		indexDelta, precisionDelta, payout := new(big.Int), new(big.Int), new(big.Int)
		if reserved {
			index, e := gaugeStorageWords(state, gauge, indexSlot, 1, false)
			if e != nil {
				return fail()
			}
			precision, e := gaugeStorageWords(state, gauge, precisionSlot, 1, false)
			if e != nil {
				return fail()
			}
			var next *big.Int
			payout, next, e = reserveGaugeRemainder(index[0], precision[0])
			if e != nil {
				return fail()
			}
			indexDelta.Neg(index[0])
			precisionDelta.Sub(next, precision[0])
		}
		index, e := checkLiabilityDelta(state, gauge, indexSlot, indexDelta)
		if e != nil {
			return fail()
		}
		precision, e := checkLiabilityDelta(state, gauge, precisionSlot, precisionDelta)
		if e != nil {
			return fail()
		}
		deferredBase := layout.DeferredQuote
		if i == 1 {
			deferredBase = layout.DeferredMeme
		}
		deferredSlot, e := gaugeSlot(deferredBase, 0)
		if e != nil {
			return fail()
		}
		deferred, e := checkLiabilityDelta(state, gauge, deferredSlot, payout)
		if e != nil {
			return fail()
		}
		out.Assets = append(out.Assets, GaugeRemainderAsset{RewardIndex: i, IndexBefore: index.Before, IndexAfter: index.After, PrecisionBefore: precision.Before, PrecisionAfter: precision.After, DeferredIncrease: payout.String(), DeferredBefore: deferred.Before, DeferredAfter: deferred.After})
	}
	out.Matched = true
	return out, nil
}
