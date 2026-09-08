package settlement

import (
	"math/big"
	"reflect"

	"tickergarden/backend/internal/chainrpc"
)

type GaugeActivationSnapshot struct {
	Generation    uint64             `json:"generation"`
	Amount        string             `json:"amount"`
	RemainingRefs string             `json:"remainingRefs"`
	Snapshot      gaugeSnapshotState `json:"snapshot"`
}
type GaugeActivationAccounting struct {
	WheelMatched   bool                      `json:"wheelMatched"`
	TotalsMatched  bool                      `json:"totalsMatched"`
	ActivatedStock string                    `json:"activatedStock"`
	Snapshots      []GaugeActivationSnapshot `json:"snapshots"`
	ActiveBefore   string                    `json:"activeBefore,omitempty"`
	ActiveAfter    string                    `json:"activeAfter,omitempty"`
	PendingBefore  string                    `json:"pendingBefore,omitempty"`
	PendingAfter   string                    `json:"pendingAfter,omitempty"`
}

// matchGaugeActivation covers every wheel slot, including generations with no
// participant in this conversion. It does not verify cohort/remainder state.
func matchGaugeActivation(p ConversionPreview, state chainrpc.TransactionStateTrace, participants GaugeStorageAccounting, timestamp uint64) (GaugeActivationAccounting, error) {
	fail := func() (GaugeActivationAccounting, error) { return GaugeActivationAccounting{}, ErrIntent }
	out := GaugeActivationAccounting{ActivatedStock: "0", Snapshots: []GaugeActivationSnapshot{}}
	if len(participants.Items) == 0 {
		return out, nil
	}
	if !participants.PositionsMatched || !participants.ParticipantSnapshotsMatched {
		return fail()
	}
	layout, _, e := verifyGaugeStorageCode(p, state)
	if e != nil {
		return fail()
	}
	gauge := p.Candidate.State.Gauge
	var current [2]string
	for i := 0; i < 2; i++ {
		slot, e := gaugeSlot(layout.Rewards, uint64(i*2))
		if e != nil {
			return fail()
		}
		w, e := gaugeStorageWords(state, gauge, slot, 1, false)
		if e != nil {
			return fail()
		}
		current[i] = w[0].String()
	}
	materialized := map[uint64]uint64{}
	for _, item := range participants.Items {
		if item.Materialized {
			materialized[item.Before.Generation]++
		}
	}
	sum := new(big.Int)
	for i := uint64(0); i < 32; i++ {
		base, e := gaugeSlot(layout.Wheel, i*3)
		if e != nil {
			return fail()
		}
		gen, e := gaugeStorageWords(state, gauge, base, 1, false)
		if e != nil || gen[0].BitLen() > 64 {
			return fail()
		}
		generation := gen[0].Uint64()
		if generation == 0 || generation > timestamp {
			// Empty/future slots can be skipped by the compiled loop without accessing
			// amount/refs. Absence of a diff proves no reported change, not a zero value.
			for offset := uint64(0); offset < 3; offset++ {
				slot, e := gaugeSlot(base, offset)
				if e != nil {
					return fail()
				}
				if _, e := checkLiabilityDelta(state, gauge, slot, new(big.Int)); e != nil {
					return fail()
				}
			}
			continue
		}
		if generation%32 != i {
			return fail()
		}
		before, e := gaugeStorageWords(state, gauge, base, 3, false)
		if e != nil || before[1].Sign() == 0 || before[2].Sign() == 0 {
			return fail()
		}
		after, e := gaugeStorageWords(state, gauge, base, 3, true)
		if e != nil {
			return fail()
		}
		for _, n := range after {
			if n.Sign() != 0 {
				return fail()
			}
		}
		sum.Add(sum, before[1])
		if sum.BitLen() > 256 {
			return fail()
		}
		snapshotBase, e := gaugeMappingSlot(layout.Snapshots, new(big.Int).SetUint64(generation))
		if e != nil {
			return fail()
		}
		old, e := gaugeStorageWords(state, gauge, snapshotBase, 4, false)
		if e != nil {
			return fail()
		}
		for _, n := range old {
			if n.Sign() != 0 {
				return fail()
			}
		}
		refs := new(big.Int).Sub(before[2], new(big.Int).SetUint64(materialized[generation]))
		if refs.Sign() < 0 {
			return fail()
		}
		want := gaugeSnapshotState{Accumulators: current, Refs: refs.String(), Processed: true}
		if refs.Sign() == 0 {
			want = gaugeSnapshotState{Accumulators: [2]string{"0", "0"}, Refs: "0"}
		}
		w, e := gaugeStorageWords(state, gauge, snapshotBase, 4, true)
		if e != nil {
			return fail()
		}
		got, e := decodeGaugeSnapshot(w)
		if e != nil || !reflect.DeepEqual(got, want) {
			return fail()
		}
		out.Snapshots = append(out.Snapshots, GaugeActivationSnapshot{Generation: generation, Amount: before[1].String(), RemainingRefs: refs.String(), Snapshot: got})
	}
	activeSlot, e := gaugeSlot(layout.ActiveTotal, 0)
	if e != nil {
		return fail()
	}
	active, e := checkLiabilityDelta(state, gauge, activeSlot, sum)
	if e != nil {
		return fail()
	}
	pendingSlot, e := gaugeSlot(layout.PendingTotal, 0)
	if e != nil {
		return fail()
	}
	pending, e := checkLiabilityDelta(state, gauge, pendingSlot, new(big.Int).Neg(sum))
	if e != nil {
		return fail()
	}
	out.WheelMatched = true
	out.TotalsMatched = true
	out.ActivatedStock = sum.String()
	out.ActiveBefore = active.Before
	out.ActiveAfter = active.After
	out.PendingBefore = pending.Before
	out.PendingAfter = pending.After
	return out, nil
}
