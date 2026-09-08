// Package rewards combines block-end reward views with observed claim history.
// It does not certify complete history or authorize a claim/conversion transaction.
package rewards

import (
	"errors"
	"math/big"
	"regexp"
	"sort"
	"strings"

	"tickergarden/backend/internal/deployment"
)

type ClaimTotal struct {
	MarketID string `json:"marketId"`
	FeeAsset string `json:"feeAsset"`
	Role     string `json:"beneficiaryType"`
	User     string `json:"beneficiary"`
	Epoch    string `json:"beneficiaryEpoch"`
	Amount   string `json:"claimedAmount"`
	Count    string `json:"claimCount"`
	First    string `json:"firstClaimEventKey"`
}

var address = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var hash = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var decimal = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

func number(s string, bits int) bool {
	if !decimal.MatchString(s) {
		return false
	}
	n, ok := new(big.Int).SetString(s, 10)
	return ok && (bits == 0 || n.BitLen() <= bits)
}
func identity(market, asset, role, user, epoch string) string {
	return strings.Join([]string{market, asset, role, user, epoch}, ":")
}
func text(v map[string]any, k string) string { s, _ := v[k].(string); return s }

// Build requires all views to come from one pinned block; the caller binds the
// resulting rows to that block in the same transaction as the input claims.
func Build(observations []deployment.StateObservation, claims []ClaimTotal) ([]deployment.StateObservation, error) {
	fail := func() ([]deployment.StateObservation, error) {
		return nil, errors.New("inconsistent reward position inputs")
	}
	totals := map[string]ClaimTotal{}
	for _, c := range claims {
		if !hash.MatchString(c.MarketID) || !address.MatchString(c.FeeAsset) || !address.MatchString(c.User) || !number(c.Epoch, 32) || !number(c.Amount, 0) || !number(c.Count, 0) || c.Count == "0" || c.First == "" {
			return fail()
		}
		if c.Role != "0" && c.Role != "1" {
			continue
		}
		if (c.Role == "0" && c.Epoch == "0") || (c.Role == "1" && c.Epoch != "0") {
			return fail()
		}
		key := identity(c.MarketID, c.FeeAsset, c.Role, c.User, c.Epoch)
		if _, exists := totals[key]; exists {
			return fail()
		}
		totals[key] = c
	}
	phases := map[string]string{}
	for _, row := range observations {
		if row.Kind != "canonicalRoute" {
			continue
		}
		phase := text(row.Value, "launchPhase")
		if !hash.MatchString(row.Key) || (phase != "0" && phase != "1") {
			return fail()
		}
		if _, exists := phases[row.Key]; exists {
			return fail()
		}
		phases[row.Key] = phase
	}
	assets := map[string][2]string{}
	for _, row := range observations {
		if row.Kind != "gauge" {
			continue
		}
		id, ok := row.Value["identity"].(map[string]any)
		if !ok {
			return fail()
		}
		market := text(id, "marketId")
		if !hash.MatchString(market) || row.Key != market {
			return fail()
		}
		if _, exists := assets[market]; exists {
			return fail()
		}
		assets[market] = [2]string{text(id, "quoteAsset"), text(id, "memeToken")}
	}
	out := map[string]deployment.StateObservation{}
	seenClaims := map[string]bool{}
	observedTimestamp := ""
	for _, row := range observations {
		v := row.Value
		role, epoch, user, market := "0", text(v, "epoch"), text(v, "beneficiary"), text(v, "marketId")
		pair := [2]string{text(v, "quoteAsset"), text(v, "memeAsset")}
		amounts := [2]string{text(v, "quoteLiability"), text(v, "memeLiability")}
		if row.Kind == "gaugePosition" {
			role, epoch, user = "1", "0", text(v, "user")
			var exists bool
			pair, exists = assets[market]
			if !exists {
				return fail()
			}
			amounts = [2]string{text(v, "quoteClaimable"), text(v, "memeClaimable")}
		} else if row.Kind != "creatorEpoch" {
			continue
		}
		if !hash.MatchString(market) || !address.MatchString(user) || user == "0x"+strings.Repeat("0", 40) || !number(epoch, 32) || (role == "0" && epoch == "0") || !address.MatchString(pair[0]) || !address.MatchString(pair[1]) || pair[0] == pair[1] || pair[1] == "0x"+strings.Repeat("0", 40) {
			return fail()
		}
		expectedKey := market + ":" + epoch
		if role == "1" {
			expectedKey = user + ":" + market
		}
		if row.Key != expectedKey {
			return fail()
		}
		if existing, exists := assets[market]; exists && existing != pair {
			return fail()
		}
		assets[market] = pair
		exitAt, ts := text(v, "rawRewardExitAt"), text(v, "observedAtTimestamp")
		ready, ok := v["rawRewardExitReady"].(bool)
		if !ok || !number(exitAt, 256) || !number(ts, 64) {
			return fail()
		}
		if observedTimestamp != "" && observedTimestamp != ts {
			return fail()
		}
		observedTimestamp = ts
		exitNum, _ := new(big.Int).SetString(exitAt, 10)
		timeNum, _ := new(big.Int).SetString(ts, 10)
		if ready != (exitNum.Sign() > 0 && exitNum.Cmp(timeNum) <= 0) {
			return fail()
		}
		phase, exists := phases[market]
		if !exists {
			return fail()
		}
		pending := false
		unlockAt, lockSatisfied := "0", true
		if role == "1" {
			var ok bool
			pending, ok = v["rageQuitSettlementPending"].(bool)
			if !ok || !number(text(v, "rageQuitSettlementPrincipal"), 256) {
				return fail()
			}
		}
		if role == "1" {
			active, queued := text(v, "activeAmount"), text(v, "pendingAmount")
			unlockAt = text(v, "unlockAt")
			if !number(active, 256) || !number(queued, 256) || !number(unlockAt, 64) {
				return fail()
			}
			if active != "0" || queued != "0" {
				if unlockAt == "0" {
					return fail()
				}
				unlock, _ := new(big.Int).SetString(unlockAt, 10)
				lockSatisfied = unlock.Cmp(timeNum) <= 0
			}
		}
		for i, asset := range pair {
			if !number(amounts[i], 256) {
				return fail()
			}
			key := identity(market, asset, role, user, epoch)
			if _, exists := out[key]; exists {
				return fail()
			}
			amount, count := "0", "0"
			var first any
			if c, exists := totals[key]; exists {
				amount, count, first = c.Amount, c.Count, c.First
				seenClaims[key] = true
			}
			kind := "quote"
			if i == 1 {
				kind = "meme"
			}
			conversionStatus, candidate := "not_applicable", "0"
			if i == 1 {
				switch {
				case amounts[i] == "0":
					conversionStatus = "no_rewards"
				case phase != "1":
					conversionStatus = "not_graduated"
				case pending:
					conversionStatus = "rage_quit_pending"
				case ready:
					conversionStatus = "raw_exit_ready"
				default:
					conversionStatus, candidate = "candidate", amounts[i]
				}
			}
			claimStatus := "candidate"
			switch {
			case amounts[i] == "0":
				claimStatus = "no_rewards"
			case pending:
				claimStatus = "rage_quit_pending"
			case !lockSatisfied:
				claimStatus = "position_locked"
			case i == 1 && exitAt == "0":
				claimStatus = "raw_exit_required"
			case i == 1 && !ready:
				claimStatus = "raw_exit_waiting"
			}
			claimCandidate := "0"
			if claimStatus == "candidate" {
				claimCandidate = amounts[i]
			}
			out[key] = deployment.StateObservation{Kind: "rewardPosition", Key: key, Value: map[string]any{
				"marketId": market, "feeAsset": asset, "assetKind": kind, "beneficiaryType": role, "beneficiary": user, "beneficiaryEpoch": epoch,
				"unpaidAmount": amounts[i], "observedClaimedAmount": amount, "observedClaimCount": count, "firstClaimEventKey": first,
				"rawRewardExitAt": exitAt, "rawRewardExitReady": ready, "observedAtTimestamp": ts,
				"historyComplete": false, "publicationEligible": false,
				"claimStatus": claimStatus, "claimCandidateAmount": claimCandidate,
				"positionUnlockAt": unlockAt, "positionLockSatisfied": lockSatisfied,
				"conversionStatus": conversionStatus, "conversionCandidateAmount": candidate,
			}}
		}
	}
	if len(seenClaims) != len(totals) {
		return fail()
	}
	keys := make([]string, 0, len(out))
	for key := range out {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]deployment.StateObservation, 0, len(keys))
	for _, key := range keys {
		result = append(result, out[key])
	}
	return result, nil
}
