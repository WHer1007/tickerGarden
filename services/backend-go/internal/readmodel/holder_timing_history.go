package readmodel

import (
	"errors"
	"strconv"
)

type holderTimingCheck struct {
	distributor, kind       string
	at, windowEnd, deadline uint64
}

// Includes cancelled/expired attempts: resetting current epoch state must not
// erase historical timing checks. Request numbers are canonical receipt numbers;
// source hashes are checked against stored canonical blocks in the caller.
func (h *holderClaimHistory) verifyTiming(holders []HolderMarketCandidate) error {
	bad := errors.New("Holder receipt timing differs from Treasury policy")
	policies := map[string][5]uint64{}
	for _, holder := range holders {
		if holder.Mode != "epoch" {
			continue
		}
		if holder.Epoch == nil {
			return bad
		}
		e := holder.Epoch
		var values [5]uint64
		for i, raw := range []string{e.FinalityDelaySeconds, e.FinalityDelayBlocks, e.RootPublicationWindow, e.RootReviewDelay, e.ClaimWindow} {
			n, err := strconv.ParseUint(raw, 10, 32)
			if err != nil || n == 0 || strconv.FormatUint(n, 10) != raw || (i == 1 && n > 255) {
				return bad
			}
			values[i] = n
		}
		if previous, exists := policies[holder.Distributor]; exists && previous != values {
			return bad
		}
		policies[holder.Distributor] = values
	}
	for _, check := range h.timingChecks {
		policy, known := policies[check.distributor]
		if !known {
			continue
		}
		switch check.kind {
		case "request":
			if check.at < check.windowEnd || check.at-check.windowEnd < policy[0] || check.deadline < check.at || check.deadline-check.at != policy[2] {
				return bad
			}
		case "publish":
			if check.deadline < check.at || check.deadline-check.at != policy[3] {
				return bad
			}
		case "finalize":
			if check.deadline != 0 && (check.deadline < check.at || check.deadline-check.at != policy[4]) {
				return bad
			}
		default:
			return bad
		}
	}
	for _, request := range h.requestSources {
		policy, known := policies[request.distributor]
		if !known {
			continue
		}
		delay := policy[1]
		if request.number <= delay || request.source != request.number-delay {
			return bad
		}
	}
	return nil
}

// Preserve every attempt, including requests later cancelled or expired.
type holderRequestSource struct {
	distributor    string
	number, source uint64
	hash           string
}
