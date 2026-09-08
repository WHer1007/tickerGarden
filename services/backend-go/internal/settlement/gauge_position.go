package settlement

import "math/big"

type gaugeUserReward struct {
	Paid      string `json:"paid"`
	Pending   string `json:"pending"`
	Remainder string `json:"remainder"`
}
type gaugePositionState struct {
	Active     string             `json:"active"`
	Pending    string             `json:"pending"`
	Generation uint64             `json:"generation"`
	UnlockAt   uint64             `json:"unlockAt"`
	Rewards    [2]gaugeUserReward `json:"rewards"` // Quote, Meme
}
type gaugeSnapshotState struct {
	Accumulators [2]string `json:"accumulators"`
	Refs         string    `json:"refs"`
	Processed    bool      `json:"processed"`
}
type gaugeActivationBucket struct {
	Generation uint64 `json:"generation"`
	Amount     string `json:"amount"`
	Refs       string `json:"refs"`
}
type gaugePositionReplay struct {
	Position     gaugePositionState `json:"position"`
	Snapshot     gaugeSnapshotState `json:"snapshot"`
	Pulled       string             `json:"pulled"`
	Materialized bool               `json:"materialized"`
}

func gaugePrecision() *big.Int { return new(big.Int).Exp(big.NewInt(10), big.NewInt(27), nil) }

// accrueGaugeTerm mirrors Solidity's full-width mulDiv plus mulmod carry. A
// 512-bit intermediate product is valid; only stored uint256 results overflow.
func accrueGaugeTerm(reward gaugeUserReward, weight, start, current string) (gaugeUserReward, error) {
	fail := func() (gaugeUserReward, error) { return gaugeUserReward{}, ErrIntent }
	w, we := amount(weight)
	s, se := amount(start)
	c, ce := amount(current)
	pending, pe := amount(reward.Pending)
	remainder, re := amount(reward.Remainder)
	if we != nil || se != nil || ce != nil || pe != nil || re != nil || c.Cmp(s) < 0 || remainder.Cmp(gaugePrecision()) >= 0 {
		return fail()
	}
	if w.Sign() == 0 || c.Cmp(s) == 0 {
		return reward, nil
	}
	product := new(big.Int).Mul(w, new(big.Int).Sub(c, s))
	whole, fraction := new(big.Int), new(big.Int)
	whole.QuoRem(product, gaugePrecision(), fraction)
	if whole.BitLen() > 256 {
		return fail()
	}
	merged := new(big.Int).Add(remainder, fraction)
	carry := new(big.Int).Quo(merged, gaugePrecision())
	whole.Add(whole, carry)
	if whole.BitLen() > 256 {
		return fail()
	}
	pending.Add(pending, whole)
	if pending.BitLen() > 256 {
		return fail()
	}
	reward.Pending = pending.String()
	reward.Remainder = new(big.Int).Mod(merged, gaugePrecision()).String()
	return reward, nil
}

// replayGaugePosition models a user's local consume/credit transition. Inputs
// must later be bound to transaction-start storage, verified clone code and the
// actual pre-conversion accumulators. It is not an RPC verification result and
// does not model unrelated activation buckets or orphaned global remainders.
func replayGaugePosition(before gaugePositionState, snapshot gaugeSnapshotState, bucket gaugeActivationBucket, current [2]string, timestamp uint64, maximum, refund, quote string) (gaugePositionReplay, error) {
	fail := func() (gaugePositionReplay, error) { return gaugePositionReplay{}, ErrIntent }
	active, ae := amount(before.Active)
	pending, pe := amount(before.Pending)
	max, me := amount(maximum)
	refundN, re := amount(refund)
	quoteN, qe := amount(quote)
	if ae != nil || pe != nil || me != nil || re != nil || qe != nil || max.Sign() == 0 {
		return fail()
	}
	for i := 0; i < 2; i++ {
		if _, e := amount(current[i]); e != nil {
			return fail()
		}
		if _, e := amount(before.Rewards[i].Paid); e != nil {
			return fail()
		}
	}
	out := gaugePositionReplay{Position: before, Snapshot: snapshot}
	if pending.Sign() == 0 && before.Generation != 0 || pending.Sign() != 0 && before.Generation == 0 {
		return fail()
	}
	materialized := false
	if pending.Sign() != 0 {
		refs, e := amount(snapshot.Refs)
		if e != nil {
			return fail()
		}
		for _, s := range snapshot.Accumulators {
			if _, e := amount(s); e != nil {
				return fail()
			}
		}
		if !snapshot.Processed && before.Generation <= timestamp {
			n, ne := amount(bucket.Amount)
			r, rr := amount(bucket.Refs)
			if snapshot.Accumulators != [2]string{"0", "0"} || refs.Sign() != 0 || bucket.Generation != before.Generation || ne != nil || rr != nil || n.Cmp(pending) < 0 || r.Sign() == 0 {
				return fail()
			}
			snapshot = gaugeSnapshotState{Accumulators: current, Refs: r.String(), Processed: true}
			refs = r
		}
		if snapshot.Processed {
			if refs.Sign() == 0 {
				return fail()
			}
			materialized = true
			for i := 0; i < 2; i++ {
				reward, e := accrueGaugeTerm(out.Position.Rewards[i], before.Active, before.Rewards[i].Paid, current[i])
				if e != nil {
					return fail()
				}
				reward, e = accrueGaugeTerm(reward, before.Pending, snapshot.Accumulators[i], current[i])
				if e != nil {
					return fail()
				}
				reward.Paid = current[i]
				out.Position.Rewards[i] = reward
			}
			active.Add(active, pending)
			if active.BitLen() > 256 {
				return fail()
			}
			out.Position.Active = active.String()
			out.Position.Pending = "0"
			out.Position.Generation = 0
			refs.Sub(refs, big.NewInt(1))
			snapshot.Refs = refs.String()
			if refs.Sign() == 0 {
				snapshot = gaugeSnapshotState{Accumulators: [2]string{"0", "0"}, Refs: "0"}
			}
		}
	}
	for i := 0; i < 2; i++ {
		reward, e := accrueGaugeTerm(out.Position.Rewards[i], out.Position.Active, out.Position.Rewards[i].Paid, current[i])
		if e != nil {
			return fail()
		}
		reward.Paid = current[i]
		out.Position.Rewards[i] = reward
	}
	available, e := amount(out.Position.Rewards[1].Pending)
	if e != nil {
		return fail()
	}
	pull := new(big.Int).Set(available)
	if pull.Cmp(max) > 0 {
		pull.Set(max)
	}
	if pull.Sign() == 0 || refundN.Cmp(pull) > 0 {
		return fail()
	}
	available.Sub(available, pull)
	available.Add(available, refundN)
	if available.BitLen() > 256 {
		return fail()
	}
	q, e := amount(out.Position.Rewards[0].Pending)
	if e != nil {
		return fail()
	}
	q.Add(q, quoteN)
	if q.BitLen() > 256 {
		return fail()
	}
	out.Position.Rewards[1].Pending = available.String()
	out.Position.Rewards[0].Pending = q.String()
	out.Snapshot = snapshot
	out.Pulled = pull.String()
	out.Materialized = materialized
	return out, nil
}
