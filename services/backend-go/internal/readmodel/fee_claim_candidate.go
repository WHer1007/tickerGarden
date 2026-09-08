package readmodel

import (
	"encoding/json"
	"errors"
	"math/big"
	"sort"
	"strconv"
	"strings"
)

// FeeClaimCandidate records paid amounts in the configured replay range only.
// It excludes reward conversions and is not a lifetime entitlement calculation.
type FeeClaimCandidate struct {
	MarketID           string      `json:"marketId"`
	FeeAsset           string      `json:"feeAsset"`
	BeneficiaryType    string      `json:"beneficiaryType"`
	Beneficiary        string      `json:"beneficiary"`
	BeneficiaryEpoch   string      `json:"beneficiaryEpoch"`
	ClaimedAmount      string      `json:"claimedAmount"`
	ClaimCount         string      `json:"claimCount"`
	FirstClaimEventKey string      `json:"firstClaimEventKey"`
	Source             SourceBlock `json:"source"`
}

func buildFeeClaimCandidates(rows map[string]json.RawMessage, c CandidateSet) ([]FeeClaimCandidate, error) {
	bad := errors.New("invalid fee claim history candidate")
	if len(rows) > 100000 {
		return nil, bad
	}
	markets := map[string]MarketReadModel{}
	for _, m := range c.Markets {
		markets[m.MarketID] = m
	}
	keys := make([]string, 0, len(rows))
	for key := range rows {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]FeeClaimCandidate, 0, len(keys))
	for _, key := range keys {
		var row struct {
			Values     FeeClaimCandidate `json:"values"`
			Provenance SourceBlock       `json:"provenance"`
		}
		if json.Unmarshal(rows[key], &row) != nil {
			return nil, bad
		}
		value := row.Values
		value.Source = row.Provenance
		market, ok := markets[value.MarketID]
		if !ok || (value.FeeAsset != market.QuoteAsset && value.FeeAsset != market.MemeToken) || !candidateAddress.MatchString(value.Beneficiary) || value.Beneficiary == "0x"+strings.Repeat("0", 40) {
			return nil, bad
		}
		role, e := strconv.ParseUint(value.BeneficiaryType, 10, 8)
		if e != nil || role > 3 || strconv.FormatUint(role, 10) != value.BeneficiaryType {
			return nil, bad
		}
		epoch, e := strconv.ParseUint(value.BeneficiaryEpoch, 10, 32)
		if e != nil || strconv.FormatUint(epoch, 10) != value.BeneficiaryEpoch {
			return nil, bad
		}
		count, e := strconv.ParseUint(value.ClaimCount, 10, 64)
		if e != nil || count == 0 || count > 100000 || strconv.FormatUint(count, 10) != value.ClaimCount {
			return nil, bad
		}
		if len(value.ClaimedAmount) > 84 {
			return nil, bad
		}
		amount, ok := new(big.Int).SetString(value.ClaimedAmount, 10)
		if !ok || amount.Sign() < 0 || amount.String() != value.ClaimedAmount {
			return nil, bad
		}
		maximum := new(big.Int).Mul(new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)), new(big.Int).SetUint64(count))
		if amount.Cmp(maximum) > 0 || value.FirstClaimEventKey == "" {
			return nil, bad
		}
		if key != strings.Join([]string{value.MarketID, value.FeeAsset, value.BeneficiaryType, value.Beneficiary, value.BeneficiaryEpoch}, ":") {
			return nil, bad
		}
		at, e := Height(value.Source.BlockNumber)
		end, e2 := Height(c.BlockNumber)
		raw, e3 := json.Marshal(value.Source)
		if e != nil || e2 != nil || e3 != nil || at > end || value.Source.ChainID != c.ChainID || (at == end && value.Source.BlockHash != c.BlockHash) || ValidateResponse("SourceBlock", raw) != nil {
			return nil, bad
		}
		out = append(out, value)
	}
	return out, nil
}
