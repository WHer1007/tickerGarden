package readmodel

import (
	"errors"
	"sort"

	"tickergarden/backend/internal/deployment"
)

// HolderMarketCandidate describes the configured reward mechanism at the candidate
// block. It is not a per-user claim or a proof that all funding has been reconciled.
type HolderMarketCandidate struct {
	MarketID    string                     `json:"marketId"`
	Distributor string                     `json:"distributor"`
	MemeToken   string                     `json:"memeToken"`
	QuoteAsset  string                     `json:"quoteAsset"`
	Mode        string                     `json:"mode"`
	Continuous  *ContinuousHolderCandidate `json:"continuous,omitempty"`
	Epoch       *EpochHolderCandidate      `json:"epoch,omitempty"`
}
type ContinuousHolderCandidate struct {
	Funded         string `json:"funded"`
	Paid           string `json:"paid"`
	Outstanding    string `json:"outstanding"`
	StreamDuration string `json:"streamDuration"`
	LastFundingAt  string `json:"lastFundingAt"`
}
type EpochHolderCandidate struct {
	FinalityDelaySeconds  string `json:"finalityDelaySeconds"`
	FinalityDelayBlocks   string `json:"finalityDelayBlocks"`
	RootPublicationWindow string `json:"rootPublicationWindow"`
	RootReviewDelay       string `json:"rootReviewDelay"`
	ClaimWindow           string `json:"claimWindow"`

	RootServiceTreasury     string              `json:"rootServiceTreasury"`
	CurrentServiceFeeAsset  string              `json:"currentServiceFeeAsset"`
	CurrentServiceFeeAmount string              `json:"currentServiceFeeAmount"`
	Entries                 []HolderEpochDetail `json:"entries"`
	CurrentEpoch            string              `json:"currentEpoch"`
	EpochDuration           string              `json:"epochDuration"`
	ActivatedAt             string              `json:"activatedAt"`
	EligibilityPolicyHash   string              `json:"eligibilityPolicyHash"`
	TwabSchema              string              `json:"twabSchema"`
}

func BuildHolderCandidates(batch deployment.ObservationBatch, markets map[string]MarketReadModel) ([]HolderMarketCandidate, error) {
	bad := errors.New("invalid Holder market candidate")
	out := []HolderMarketCandidate{}
	seen := map[string]bool{}
	sharing := map[string]bool{}
	for _, o := range batch.Observations {
		if o.Kind == "market" {
			enabled, ok := o.Value["creatorFeesToHolders"].(bool)
			if !ok {
				return nil, bad
			}
			sharing[o.Key] = enabled
		}
	}
	for _, o := range batch.Observations {
		if o.Kind != "holderMarket" {
			continue
		}
		get := func(key string) string { s, _ := o.Value[key].(string); return s }
		m, ok := markets[o.Key]
		if !ok || !sharing[o.Key] || seen[o.Key] || get("marketId") != o.Key {
			return nil, bad
		}
		c := HolderMarketCandidate{MarketID: o.Key, Distributor: get("treasuryDistributor"), MemeToken: m.MemeToken, QuoteAsset: m.QuoteAsset}
		if !candidateAddress.MatchString(c.Distributor) || c.Distributor == "0x0000000000000000000000000000000000000000" {
			return nil, bad
		}
		uintValue := func(s string, bits int) bool {
			if len(s) > 78 {
				return false
			}
			n, e := raw(s)
			return e == nil && n.BitLen() <= bits && n.String() == s
		}
		mode, hasMode := o.Value["rewardMode"]
		if hasMode {
			if mode != "continuous-24h" || get("token") != m.MemeToken || get("quote") != m.QuoteAsset || get("streamDuration") != "86400" || !uintValue(get("lastFundingAt"), 64) {
				return nil, bad
			}
			funded, e := raw(get("funded"))
			if e != nil || funded.String() != get("funded") {
				return nil, bad
			}
			paid, e := raw(get("paid"))
			if e != nil || paid.String() != get("paid") || paid.Cmp(funded) > 0 {
				return nil, bad
			}
			c.Mode = "continuous-24h"
			c.Continuous = &ContinuousHolderCandidate{Funded: funded.String(), Paid: paid.String(), Outstanding: funded.Sub(funded, paid).String(), StreamDuration: "86400", LastFundingAt: get("lastFundingAt")}
		} else {
			if !candidateAddress.MatchString(get("rootServiceTreasury")) || get("rootServiceTreasury") == "0x0000000000000000000000000000000000000000" || get("rootServiceTreasury") == get("treasuryDistributor") || !candidateAddress.MatchString(get("currentServiceFeeAsset")) || !uintValue(get("currentServiceFeeAmount"), 128) || get("currentServiceFeeAmount") == "0" || get("memeToken") != m.MemeToken || get("quoteToken") != m.QuoteAsset || !uintValue(get("currentEpochId"), 32) || get("currentEpochId") == "0" || !uintValue(get("epochDuration"), 32) || get("epochDuration") == "0" || !uintValue(get("activatedAt"), 64) || get("activatedAt") == "0" || !candidateHash.MatchString(get("eligibilityPolicyHash")) || get("eligibilityPolicyHash") == "0x0000000000000000000000000000000000000000000000000000000000000000" || !candidateHash.MatchString(get("twabSchema")) || get("twabSchema") == "0x0000000000000000000000000000000000000000000000000000000000000000" {
				return nil, bad
			}
			c.Mode = "epoch"
			for _, field := range []string{"finalityDelaySeconds", "finalityDelayBlocks", "rootPublicationWindow", "rootReviewDelay", "claimWindow"} {
				bits := 32
				if field == "finalityDelayBlocks" {
					bits = 8
				}
				if !uintValue(get(field), bits) || get(field) == "0" {
					return nil, bad
				}
			}
			c.Epoch = &EpochHolderCandidate{FinalityDelaySeconds: get("finalityDelaySeconds"), FinalityDelayBlocks: get("finalityDelayBlocks"), RootPublicationWindow: get("rootPublicationWindow"), RootReviewDelay: get("rootReviewDelay"), ClaimWindow: get("claimWindow"), RootServiceTreasury: get("rootServiceTreasury"), CurrentServiceFeeAsset: get("currentServiceFeeAsset"), CurrentServiceFeeAmount: get("currentServiceFeeAmount"), CurrentEpoch: get("currentEpochId"), EpochDuration: get("epochDuration"), ActivatedAt: get("activatedAt"), EligibilityPolicyHash: get("eligibilityPolicyHash"), TwabSchema: get("twabSchema")}
		}
		seen[o.Key] = true
		out = append(out, c)
	}
	for id, enabled := range sharing {
		if enabled && !seen[id] {
			return nil, bad
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].MarketID < out[j].MarketID })
	if e := holderEpochDetails(batch, out); e != nil {
		return nil, e
	}
	return out, nil
}
