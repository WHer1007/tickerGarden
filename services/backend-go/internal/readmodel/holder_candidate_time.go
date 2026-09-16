package readmodel

import (
	"errors"
	"strconv"
)

// Occurred-at fields cannot be in the future. Claim/publish/finalize deadlines
// may be, and are deliberately not treated as occurrence timestamps here.
func verifyHolderCandidateTime(holders []HolderMarketCandidate, height, timestamp uint64) error {
	bad := errors.New("Holder observation exceeds canonical block")
	bound := func(s string, max uint64) bool {
		n, e := strconv.ParseUint(s, 10, 64)
		return e == nil && strconv.FormatUint(n, 10) == s && n <= max
	}
	for _, h := range holders {
		switch h.Mode {
		case "continuous-24h":
			if h.Continuous == nil || !bound(h.Continuous.LastFundingAt, timestamp) {
				return bad
			}
		case "epoch":
			if h.Epoch == nil || !bound(h.Epoch.ActivatedAt, timestamp) || verifyHolderEpochSchedule(h.Epoch, timestamp) != nil {
				return bad
			}
			for _, entry := range h.Epoch.Entries {
				if verifyHolderEpochLifecycle(entry.Values, timestamp) != nil || !bound(entry.Values["requestedAt"], timestamp) || !bound(entry.Values["sourceBlockNumber"], height) {
					return bad
				}
			}
		default:
			return bad
		}
	}
	return nil
}
