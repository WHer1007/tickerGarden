package readmodel

import (
	"errors"
	"math/big"
	"sort"
	"strconv"

	"tickergarden/backend/internal/deployment"
)

// CreatorEpochCandidate is current unpaid entitlement at CandidateSet.BlockHash,
// not a claim-history record or a publishable rewards API response.
type CreatorEpochCandidate struct {
	RawRewardExitAt     string `json:"rawRewardExitAt"`
	RawRewardExitReady  bool   `json:"rawRewardExitReady"`
	ObservedAtTimestamp string `json:"observedAtTimestamp"`
	MarketID            string `json:"marketId"`
	Epoch               string `json:"epoch"`
	Beneficiary         string `json:"beneficiary"`
	QuoteAsset          string `json:"quoteAsset"`
	MemeAsset           string `json:"memeAsset"`
	QuoteLiability      string `json:"quoteLiability"`
	MemeLiability       string `json:"memeLiability"`
}

func buildCreatorCandidates(batch deployment.ObservationBatch, markets map[string]MarketReadModel) ([]CreatorEpochCandidate, error) {
	bad := errors.New("invalid Creator candidate entitlement")
	out := []CreatorEpochCandidate{}
	seen := map[string]bool{}
	observedAt := ""
	exits := map[string]string{}
	for _, o := range batch.Observations {
		if o.Kind != "creatorEpoch" {
			continue
		}
		get := func(key string) string { s, _ := o.Value[key].(string); return s }
		c := CreatorEpochCandidate{MarketID: get("marketId"), Epoch: get("epoch"), Beneficiary: get("beneficiary"), QuoteAsset: get("quoteAsset"), MemeAsset: get("memeAsset"), QuoteLiability: get("quoteLiability"), MemeLiability: get("memeLiability")}
		c.RawRewardExitAt = get("rawRewardExitAt")
		c.ObservedAtTimestamp = get("observedAtTimestamp")
		ready, ok := o.Value["rawRewardExitReady"].(bool)
		calculated, e := CreatorExitReady(c.RawRewardExitAt, c.ObservedAtTimestamp)
		if !ok || e != nil || ready != calculated {
			return nil, bad
		}
		c.RawRewardExitReady = ready
		if observedAt != "" && observedAt != c.ObservedAtTimestamp {
			return nil, bad
		}
		observedAt = c.ObservedAtTimestamp
		exitKey := c.MarketID + ":" + c.Beneficiary
		if previous, ok := exits[exitKey]; ok && previous != c.RawRewardExitAt {
			return nil, bad
		}
		exits[exitKey] = c.RawRewardExitAt
		m, ok := markets[c.MarketID]
		n, e := strconv.ParseUint(c.Epoch, 10, 32)
		if !ok || e != nil || n == 0 || strconv.FormatUint(n, 10) != c.Epoch || o.Key != c.MarketID+":"+c.Epoch || seen[o.Key] || !candidateAddress.MatchString(c.Beneficiary) || c.Beneficiary == "0x0000000000000000000000000000000000000000" || c.QuoteAsset != m.QuoteAsset || c.MemeAsset != m.MemeToken {
			return nil, bad
		}
		if n, e := raw(c.QuoteLiability); e != nil || n.String() != c.QuoteLiability {
			return nil, bad
		}
		if n, e := raw(c.MemeLiability); e != nil || n.String() != c.MemeLiability {
			return nil, bad
		}
		seen[o.Key] = true
		out = append(out, c)
		if len(out) > deployment.MaxCreatorEpochReads {
			return nil, bad
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].MarketID != out[j].MarketID {
			return out[i].MarketID < out[j].MarketID
		}
		a, _ := strconv.ParseUint(out[i].Epoch, 10, 32)
		b, _ := strconv.ParseUint(out[j].Epoch, 10, 32)
		return a < b
	})
	counts := map[string]uint64{}
	sums := map[string][2]*big.Int{}
	for _, c := range out {
		counts[c.MarketID]++
		if c.Epoch != strconv.FormatUint(counts[c.MarketID], 10) {
			return nil, bad
		}
		if sums[c.MarketID][0] == nil {
			sums[c.MarketID] = [2]*big.Int{new(big.Int), new(big.Int)}
		}
		total := sums[c.MarketID]
		q, _ := raw(c.QuoteLiability)
		m, _ := raw(c.MemeLiability)
		total[0].Add(total[0], q)
		total[1].Add(total[1], m)
		if total[0].BitLen() > 256 || total[1].BitLen() > 256 {
			return nil, bad
		}
	}
	matched := map[string]bool{}
	for _, o := range batch.Observations {
		if o.Kind != "feeLiability" {
			continue
		}
		id, ok := o.Value["marketId"].(string)
		if !ok {
			return nil, bad
		}
		market, ok := markets[id]
		if !ok {
			return nil, bad
		}
		asset, ok := o.Value["feeAsset"].(string)
		if !ok {
			return nil, bad
		}
		index := 0
		if asset == market.MemeToken {
			index = 1
		} else if asset != market.QuoteAsset {
			return nil, bad
		}
		key := id + ":" + asset
		if o.Key != key || matched[key] || counts[id] == 0 || o.Value["creatorEpochCount"] != strconv.FormatUint(counts[id], 10) {
			return nil, bad
		}
		if o.Value["creator"] != sums[id][index].String() {
			return nil, bad
		}
		matched[key] = true
	}
	for id := range counts {
		m := markets[id]
		if !matched[id+":"+m.QuoteAsset] || !matched[id+":"+m.MemeToken] {
			return nil, bad
		}
	}
	return out, nil
}

// CreatorExitReady uses the observed block time, never the API server clock.
func CreatorExitReady(exitAt, observedAt string) (bool, error) {
	bad := errors.New("invalid Creator exit timestamp")
	exit, e := raw(exitAt)
	if e != nil || exit.String() != exitAt {
		return false, bad
	}
	observed, e := strconv.ParseUint(observedAt, 10, 64)
	if e != nil || strconv.FormatUint(observed, 10) != observedAt {
		return false, bad
	}
	return exit.Sign() > 0 && exit.Cmp(new(big.Int).SetUint64(observed)) <= 0, nil
}

// Called inside the candidate store's read-only repeatable-read transaction.
func verifyCreatorCandidateTime(epochs []CreatorEpochCandidate, timestamp uint64) error {
	expected := strconv.FormatUint(timestamp, 10)
	for _, epoch := range epochs {
		if epoch.ObservedAtTimestamp != expected {
			return errors.New("Creator observation time differs from canonical block")
		}
		ready, e := CreatorExitReady(epoch.RawRewardExitAt, expected)
		if e != nil || ready != epoch.RawRewardExitReady {
			return errors.New("Creator exit readiness differs from canonical block")
		}
	}
	return nil
}
