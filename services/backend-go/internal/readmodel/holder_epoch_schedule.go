package readmodel

import (
	"errors"
	"math"
	"strconv"
)

// Reproduce Treasury's epoch arithmetic using the observed duration. Authenticating
// that duration against the deployed contract remains the RPC verifier's job.
func verifyHolderEpochSchedule(epoch *EpochHolderCandidate, timestamp uint64) error {
	bad := errors.New("Holder epoch schedule mismatch")
	parse := func(s string, bits int) (uint64, bool) {
		n, e := strconv.ParseUint(s, 10, bits)
		return n, e == nil && strconv.FormatUint(n, 10) == s
	}
	if epoch == nil {
		return bad
	}
	activated, ok := parse(epoch.ActivatedAt, 64)
	if !ok || activated == 0 || activated > timestamp {
		return bad
	}
	duration, ok := parse(epoch.EpochDuration, 32)
	if !ok || duration == 0 {
		return bad
	}
	current, ok := parse(epoch.CurrentEpoch, 32)
	if !ok || current == 0 {
		return bad
	}
	elapsed := (timestamp - activated) / duration
	if elapsed >= math.MaxUint32 || current != elapsed+1 {
		return bad
	}
	for _, entry := range epoch.Entries {
		id, ok := parse(entry.Epoch, 32)
		if !ok || id == 0 || id > current {
			return bad
		}
		offset := (id - 1) * duration // product of two uint32 quantities fits uint64.
		if offset > math.MaxUint64-activated {
			return bad
		}
		start := activated + offset
		if duration > math.MaxUint64-start {
			return bad
		}
		end := start + duration
		if entry.Values["windowstart"] != strconv.FormatUint(start, 10) || entry.Values["windowend"] != strconv.FormatUint(end, 10) {
			return bad
		}
		status, ok := parse(entry.Values["status"], 8)
		if !ok || status > 4 {
			return bad
		}
		requested, ok := parse(entry.Values["requestedAt"], 64)
		if !ok {
			return bad
		}
		if status != 0 && (requested < end || requested > timestamp) {
			return bad
		}
	}
	return nil
}
