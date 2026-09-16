package readmodel

import (
	"errors"
	"strconv"

	"tickergarden/backend/internal/deployment"
)

// HolderEpochDetail retains a fixed, validated field inventory. All integer values
// stay decimal strings; root hashes are evidence, not validated Merkle proofs.
type HolderEpochDetail struct {
	Epoch  string            `json:"epoch"`
	Values map[string]string `json:"values"`
}

func holderEpochDetails(batch deployment.ObservationBatch, holders []HolderMarketCandidate) error {
	bad := errors.New("invalid Holder epoch candidate")
	indexes := map[string]int{}
	expected := 0
	for i, h := range holders {
		if h.Epoch == nil {
			continue
		}
		n, e := strconv.ParseUint(h.Epoch.CurrentEpoch, 10, 32)
		if e != nil || n > deployment.MaxHolderEpochReads || expected+int(n) > deployment.MaxHolderEpochReads {
			return bad
		}
		expected += int(n)
		indexes[h.MarketID] = i
		h.Epoch.Entries = make([]HolderEpochDetail, int(n))
	}
	seen := map[string]bool{}
	for _, o := range batch.Observations {
		if o.Kind != "holderEpoch" {
			continue
		}
		get := func(k string) string { s, _ := o.Value[k].(string); return s }
		i, ok := indexes[get("marketId")]
		if !ok {
			return bad
		}
		h := holders[i]
		epoch, e := strconv.ParseUint(get("epoch"), 10, 32)
		if e != nil || epoch == 0 || epoch > uint64(len(h.Epoch.Entries)) || strconv.FormatUint(epoch, 10) != get("epoch") || o.Key != h.MarketID+":"+get("epoch") || seen[o.Key] || get("treasuryDistributor") != h.Distributor || get("quoteAsset") != h.QuoteAsset || get("memeAsset") != h.MemeToken {
			return bad
		}
		values := map[string]string{}
		for field, bits := range map[string]int{"requestedAt": 64, "publishBy": 64, "finalizeAfter": 64, "claimUntil": 64, "sourceBlockNumber": 64, "leafCount": 32, "status": 8, "serviceFeeAmount": 128, "quoteAmount": 256, "claimedAmount": 256, "totalTwab": 256, "fundedQuoteAmount": 256, "holderQuoteLiability": 256, "holderMemeLiability": 256, "outstandingQuoteAmount": 256} {
			s := get(field)
			n, e := raw(s)
			if e != nil || n.String() != s || n.BitLen() > bits {
				return bad
			}
			values[field] = s
		}
		for _, field := range []string{"requester", "serviceFeeAsset"} {
			s := get(field)
			if !candidateAddress.MatchString(s) {
				return bad
			}
			values[field] = s
		}
		for _, field := range []string{"sourceBlockHash", "merkleRoot", "datasetHash"} {
			s := get(field)
			if !candidateHash.MatchString(s) {
				return bad
			}
			values[field] = s
		}
		window, ok := o.Value["window"].(map[string]any)
		if !ok {
			return bad
		}
		for _, key := range []string{"start", "end"} {
			s, ok := window[key].(string)
			n, e := strconv.ParseUint(s, 10, 64)
			if !ok || e != nil || strconv.FormatUint(n, 10) != s {
				return bad
			}
			values["window"+key] = s
		}
		start, _ := strconv.ParseUint(values["windowstart"], 10, 64)
		end, _ := strconv.ParseUint(values["windowend"], 10, 64)
		if start >= end {
			return bad
		}
		status, _ := strconv.ParseUint(values["status"], 10, 8)
		if status > 4 {
			return bad
		}
		funded, _ := raw(values["fundedQuoteAmount"])
		claimed, _ := raw(values["claimedAmount"])
		committed, _ := raw(values["quoteAmount"])
		if claimed.Cmp(committed) > 0 {
			return bad
		}
		if status == 4 {
			if funded.Sign() != 0 || values["outstandingQuoteAmount"] != "0" {
				return bad
			}
		} else {
			if claimed.Cmp(funded) > 0 || (status > 0 && funded.Cmp(committed) != 0) || funded.Sub(funded, claimed).String() != values["outstandingQuoteAmount"] {
				return bad
			}
		}
		seen[o.Key] = true
		h.Epoch.Entries[epoch-1] = HolderEpochDetail{Epoch: get("epoch"), Values: values}
	}
	if len(seen) != expected {
		return bad
	}
	return nil
}
