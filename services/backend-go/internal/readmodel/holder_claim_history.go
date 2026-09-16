package readmodel

import (
	"errors"
	"math/big"
	"strconv"
	"strings"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

type holderClaimKey struct{ distributor, market, epoch string }
type holderFinalizedRoot struct {
	root      string
	until, at uint64
}
type holderPublishedRoot struct {
	root, dataset, twab, leaves string
	after, at                   uint64
}
type holderClaimTimes struct{ first, last uint64 }
type holderClaimHistory struct {
	roots             map[holderClaimKey]holderFinalizedRoot
	published         map[holderClaimKey]holderPublishedRoot
	requests          map[holderClaimKey]map[string]string
	times             map[holderClaimKey]holderClaimTimes
	totals            map[holderClaimKey]*big.Int
	maxLeaf           map[holderClaimKey]*big.Int
	leaves, accounts  map[string]bool
	service           map[string]*big.Int
	serviceAvailable  map[string]*big.Int
	serviceOperations []holderServiceOperation
	creditCandidates  []ServiceCreditCandidate
	timingChecks      []holderTimingCheck
	requestSources    []holderRequestSource
	claimCandidates   []TreasuryClaimCandidate
	count             int
}

func newHolderClaimHistory() *holderClaimHistory {
	return &holderClaimHistory{serviceAvailable: map[string]*big.Int{}, service: map[string]*big.Int{}, requests: map[holderClaimKey]map[string]string{}, published: map[holderClaimKey]holderPublishedRoot{}, totals: map[holderClaimKey]*big.Int{}, roots: map[holderClaimKey]holderFinalizedRoot{}, times: map[holderClaimKey]holderClaimTimes{}, maxLeaf: map[holderClaimKey]*big.Int{}, leaves: map[string]bool{}, accounts: map[string]bool{}}
}

// Inputs have passed the stored receipt/log identity checks. Emitter provenance
// still depends on the caller's optional complete manifest binding checks.
func (h *holderClaimHistory) add(input projection.Input, blockTimestamp uint64) error {
	if input.Module != "TreasuryDistributorV1" {
		return nil
	}
	decoded, e := events.Decode(input.Module, input.Log)
	if e != nil {
		return e
	}
	finalized := strings.HasPrefix(decoded.Signature, "RootFinalized(")
	published := strings.HasPrefix(decoded.Signature, "RootPublished(")
	cancelled := strings.HasPrefix(decoded.Signature, "PendingRootCancelled(")
	requested := strings.HasPrefix(decoded.Signature, "RootRequested(")
	expired := strings.HasPrefix(decoded.Signature, "RootRequestExpired(")
	withdrawn := strings.HasPrefix(decoded.Signature, "ServiceCreditWithdrawn(")
	if !withdrawn && !requested && !expired && !published && !cancelled && !finalized && !strings.HasPrefix(decoded.Signature, "TreasuryClaimed(") {
		return nil
	}
	bad := errors.New("invalid Treasury claim history")
	h.count++
	if h.count > 100000 {
		return bad
	}
	get := func(k string) string { s, _ := decoded.Args[k].(string); return s }
	key := holderClaimKey{decoded.Emitter, get("marketId"), get("epochId")}
	if withdrawn {
		amount, err := raw(get("amount"))
		balance := h.service[decoded.Emitter+":"+get("asset")]
		available := h.serviceAvailable[decoded.Emitter+":"+get("asset")]
		if err != nil || amount.Sign() == 0 || balance == nil || available == nil || amount.Cmp(available) > 0 || amount.Cmp(balance) > 0 || get("beneficiary") == "0x"+strings.Repeat("0", 40) || get("beneficiary") == decoded.Emitter {
			return bad
		}
		h.serviceOperations = append(h.serviceOperations, holderServiceOperation{distributor: decoded.Emitter, asset: get("asset"), beneficiary: get("beneficiary"), amount: amount.String(), withdrawal: true})
		balance.Sub(balance, amount)
		available.Sub(available, amount)
		return nil
	}
	if requested {
		if _, exists := h.requests[key]; exists {
			return bad
		}
		values := map[string]string{"requestedAt": strconv.FormatUint(blockTimestamp, 10)}
		for _, field := range []string{"requester", "windowStart", "windowEnd", "sourceBlockNumber", "sourceBlockHash", "quoteAmount", "serviceFeeAsset", "serviceFeeAmount", "publishBy"} {
			values[field] = get(field)
		}
		start, e1 := strconv.ParseUint(values["windowStart"], 10, 64)
		end, e2 := strconv.ParseUint(values["windowEnd"], 10, 64)
		by, e3 := strconv.ParseUint(values["publishBy"], 10, 64)
		amount, e4 := raw(values["quoteAmount"])
		fee, e5 := raw(values["serviceFeeAmount"])
		if key.epoch == "0" || blockTimestamp == 0 || e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil || start >= end || end > blockTimestamp || by <= blockTimestamp || amount.Sign() == 0 || fee.Sign() == 0 || values["requester"] == "0x"+strings.Repeat("0", 40) || values["sourceBlockHash"] == "0x"+strings.Repeat("0", 64) {
			return bad
		}
		serviceKey := key.distributor + ":" + values["serviceFeeAsset"]
		balance := h.service[serviceKey]
		if balance == nil {
			balance = new(big.Int)
		}
		next := new(big.Int).Add(balance, fee)
		if next.BitLen() > 256 {
			return bad
		}
		h.service[serviceKey] = next
		requestBlock, err := strconv.ParseUint(input.Log.BlockNumber, 0, 63)
		sourceBlock, err2 := strconv.ParseUint(values["sourceBlockNumber"], 10, 63)
		if err != nil || err2 != nil || input.Log.BlockNumber != "0x"+strconv.FormatUint(requestBlock, 16) {
			return bad
		}
		h.requestSources = append(h.requestSources, holderRequestSource{key.distributor, requestBlock, sourceBlock, values["sourceBlockHash"]})
		h.timingChecks = append(h.timingChecks, holderTimingCheck{key.distributor, "request", blockTimestamp, end, by})
		h.requests[key] = values
		return nil
	}
	if expired {
		request, exists := h.requests[key]
		_, pending := h.published[key]
		if !exists || pending || request["requester"] != get("requester") {
			return bad
		}
		by, e := strconv.ParseUint(request["publishBy"], 10, 64)
		if e != nil || blockTimestamp <= by {
			return bad
		}
		h.releaseService(key, false)
		delete(h.requests, key)
		return nil
	}
	if cancelled {
		_, exists := h.published[key]
		_, confirmed := h.roots[key]
		if !exists || confirmed || get("reasonHash") == "0x"+strings.Repeat("0", 64) {
			return bad
		}
		delete(h.published, key)
		h.releaseService(key, false)
		delete(h.requests, key)
		return nil
	}
	if published {
		request, exists := h.requests[key]
		if !exists {
			return bad
		}
		at, _ := strconv.ParseUint(request["requestedAt"], 10, 64)
		by, _ := strconv.ParseUint(request["publishBy"], 10, 64)
		if blockTimestamp < at || blockTimestamp > by {
			return bad
		}
		_, exists = h.published[key]
		after, e := strconv.ParseUint(get("finalizeAfter"), 10, 64)
		twab, e2 := raw(get("totalTwab"))
		leaves, e3 := strconv.ParseUint(get("leafCount"), 10, 32)
		zero := "0x" + strings.Repeat("0", 64)
		if exists || key.epoch == "0" || e != nil || e2 != nil || e3 != nil || after <= blockTimestamp || get("merkleRoot") == zero || get("datasetHash") == zero {
			return bad
		}
		if (twab.Sign() == 0) != (leaves == 0) {
			return bad
		}
		if leaves == 0 && get("merkleRoot") != emptyTreasuryRoot() {
			return bad
		}
		h.timingChecks = append(h.timingChecks, holderTimingCheck{key.distributor, "publish", blockTimestamp, 0, after})
		h.published[key] = holderPublishedRoot{get("merkleRoot"), get("datasetHash"), get("totalTwab"), get("leafCount"), after, blockTimestamp}
		return nil
	}
	if finalized {
		publication, exists := h.published[key]
		if !exists || publication.root != get("merkleRoot") || blockTimestamp < publication.after || (get("claimUntil") == "0") != (publication.leaves == "0") {
			return bad
		}
		until, e := strconv.ParseUint(get("claimUntil"), 10, 64)
		_, exists = h.roots[key]
		if e != nil || exists || key.epoch == "0" || get("merkleRoot") == "0x0000000000000000000000000000000000000000000000000000000000000000" || (until != 0 && until <= blockTimestamp) {
			return bad
		}
		h.releaseService(key, true)
		h.timingChecks = append(h.timingChecks, holderTimingCheck{key.distributor, "finalize", blockTimestamp, 0, until})
		h.roots[key] = holderFinalizedRoot{get("merkleRoot"), until, blockTimestamp}
		return nil
	}
	root, exists := h.roots[key]
	if !exists || root.until == 0 || blockTimestamp < root.at || blockTimestamp > root.until {
		return bad
	}
	amount, e := raw(get("amount"))
	if e != nil || amount.Sign() == 0 {
		return bad
	}
	twab, e := raw(get("twab"))
	if e != nil || twab.Sign() == 0 || get("epochId") == "0" || get("account") == "0x0000000000000000000000000000000000000000" || get("account") == decoded.Emitter {
		return bad
	}
	prefix := key.distributor + ":" + key.market + ":" + key.epoch + ":"
	leaf, account := prefix+get("leafIndex"), prefix+get("account")
	if h.leaves[leaf] || h.accounts[account] {
		return bad
	}
	leafIndex, e := raw(get("leafIndex"))
	if e != nil {
		return bad
	}
	if previous := h.maxLeaf[key]; previous == nil || leafIndex.Cmp(previous) > 0 {
		h.maxLeaf[key] = leafIndex
	}
	times, exists := h.times[key]
	if !exists {
		times = holderClaimTimes{blockTimestamp, blockTimestamp}
	} else {
		if blockTimestamp < times.first {
			times.first = blockTimestamp
		}
		if blockTimestamp > times.last {
			times.last = blockTimestamp
		}
	}
	h.times[key] = times
	h.leaves[leaf] = true
	h.accounts[account] = true
	if h.totals[key] == nil {
		h.totals[key] = new(big.Int)
	}
	h.totals[key].Add(h.totals[key], amount)
	if h.totals[key].BitLen() > 256 {
		return bad
	}
	h.claimCandidates = append(h.claimCandidates, TreasuryClaimCandidate{key.distributor, key.market, key.epoch, get("leafIndex"), get("account"), get("twab"), get("amount")})
	return nil
}
func (h *holderClaimHistory) verify(holders []HolderMarketCandidate) error {
	bad := errors.New("Holder root or claim state differs from receipt history")
	markets := map[string]bool{}
	matched := map[holderClaimKey]bool{}
	for _, holder := range holders {
		if holder.Mode != "epoch" {
			continue
		}
		if holder.Epoch == nil {
			return bad
		}
		markets[holder.MarketID] = true
		for _, entry := range holder.Epoch.Entries {
			key := holderClaimKey{holder.Distributor, holder.MarketID, entry.Epoch}
			root, hasRoot := h.roots[key]
			status := entry.Values["status"]
			request, hasRequest := h.requests[key]
			if status != "0" {
				if !hasRequest {
					return bad
				}
				for _, field := range []string{"requestedAt", "requester", "sourceBlockNumber", "sourceBlockHash", "quoteAmount", "serviceFeeAsset", "serviceFeeAmount", "publishBy"} {
					if request[field] != entry.Values[field] {
						return bad
					}
				}
				if request["windowStart"] != entry.Values["windowstart"] || request["windowEnd"] != entry.Values["windowend"] {
					return bad
				}
			} else if hasRequest {
				return bad
			}
			publication, hasPublication := h.published[key]
			if status == "2" || status == "3" || status == "4" {
				requested, e1 := strconv.ParseUint(entry.Values["requestedAt"], 10, 64)
				publishBy, e2 := strconv.ParseUint(entry.Values["publishBy"], 10, 64)
				if !hasPublication || e1 != nil || e2 != nil || publication.at < requested || publication.at > publishBy || publication.root != entry.Values["merkleRoot"] || publication.dataset != entry.Values["datasetHash"] || publication.twab != entry.Values["totalTwab"] || publication.leaves != entry.Values["leafCount"] || strconv.FormatUint(publication.after, 10) != entry.Values["finalizeAfter"] {
					return bad
				}
			} else if hasPublication {
				return bad
			}
			if status == "3" || status == "4" {
				start, e := strconv.ParseUint(entry.Values["finalizeAfter"], 10, 64)
				if !hasRoot || e != nil || root.root != entry.Values["merkleRoot"] || strconv.FormatUint(root.until, 10) != entry.Values["claimUntil"] || root.at < start {
					return bad
				}
			} else if hasRoot {
				return bad
			}
			expected, e := raw(entry.Values["claimedAmount"])
			if e != nil {
				return bad
			}
			sum := h.totals[key]
			if sum == nil {
				sum = new(big.Int)
			}
			if maximum := h.maxLeaf[key]; maximum != nil {
				count, e := raw(entry.Values["leafCount"])
				if e != nil || maximum.Cmp(count) >= 0 {
					return bad
				}
			}
			if times, exists := h.times[key]; exists {
				start, e1 := strconv.ParseUint(entry.Values["finalizeAfter"], 10, 64)
				end, e2 := strconv.ParseUint(entry.Values["claimUntil"], 10, 64)
				if e1 != nil || e2 != nil || times.first < start || times.last > end {
					return bad
				}
			}
			if expected.Cmp(sum) != 0 {
				return bad
			}
			matched[key] = true
		}
	}
	for key := range h.requests {
		if markets[key.market] && !matched[key] {
			return bad
		}
	}
	for key := range h.published {
		if markets[key.market] && !matched[key] {
			return bad
		}
	}
	for key := range h.roots {
		if markets[key.market] && !matched[key] {
			return bad
		}
	}
	for key := range h.totals {
		if markets[key.market] && !matched[key] {
			return bad
		}
	}
	return nil
}

func emptyTreasuryRoot() string {
	return deployment.Hash([]byte("TICKERGARDEN_V1_TREASURY_EMPTY_EPOCH_V1"))
}

type TreasuryClaimCandidate struct {
	Distributor string `json:"distributor"`
	MarketID    string `json:"marketId"`
	Epoch       string `json:"epoch"`
	LeafIndex   string `json:"leafIndex"`
	Account     string `json:"account"`
	Twab        string `json:"twab"`
	Amount      string `json:"amount"`
}
