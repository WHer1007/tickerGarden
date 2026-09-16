package readmodel

import (
	"errors"
	"math/big"
	"strconv"
)

type EffectiveGaugePrincipal struct {
	Active       string
	Pending      string
	ActivationAt *string
	UnlockAt     *string
}

// NormalizeGaugePrincipal interprets stored positionOf principal using the
// activation snapshot, never wall-clock guesses. It does not attest RPC origin.
func NormalizeGaugePrincipal(active, pending string, generationValue, unlockValue, snapshotValue any) (EffectiveGaugePrincipal, error) {
	bad := errors.New("invalid Gauge principal or activation snapshot")
	fail := func() (EffectiveGaugePrincipal, error) { return EffectiveGaugePrincipal{}, bad }
	a, e := raw(active)
	if e != nil || a.String() != active {
		return fail()
	}
	p, e := raw(pending)
	if e != nil || p.String() != pending {
		return fail()
	}
	total := new(big.Int).Add(a, p)
	if total.BitLen() > 256 {
		return fail()
	}
	generation, ok := candidateScalar(generationValue, "uint64")
	if !ok {
		return fail()
	}
	unlock, ok := candidateScalar(unlockValue, "uint64")
	if !ok {
		return fail()
	}
	result := EffectiveGaugePrincipal{}
	if total.Sign() > 0 && unlock.(uint64) == 0 {
		return fail()
	}
	if unlock.(uint64) > 0 {
		v := strconv.FormatUint(unlock.(uint64), 10)
		result.UnlockAt = &v
	}
	if p.Sign() > 0 {
		if generation.(uint64) == 0 {
			return fail()
		}
		snapshot, ok := snapshotValue.(map[string]any)
		if !ok {
			return fail()
		}
		processed, ok := snapshot["processed"].(bool)
		if !ok {
			return fail()
		}
		for _, field := range []string{"quoteAccumulator", "memeAccumulator", "refs"} {
			if _, ok := candidateScalar(snapshot[field], "uint256"); !ok {
				return fail()
			}
		}
		if processed {
			if snapshot["refs"] == "0" {
				return fail()
			}
			a.Add(a, p)
			p.SetUint64(0)
		} else {
			v := strconv.FormatUint(generation.(uint64), 10)
			result.ActivationAt = &v
		}
	} else if generation.(uint64) != 0 {
		return fail()
	}
	result.Active = a.String()
	result.Pending = p.String()
	return result, nil
}
