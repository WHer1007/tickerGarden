package readmodel

import (
	"encoding/json"
	"math/big"
	"os"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestStoredHolderSolvency(t *testing.T) {
	for _, mode := range []string{"continuous", "epoch"} {
		for _, mutation := range []string{"valid", "surplus", "other treasury liability", "missing", "duplicate", "wrong key", "wrong asset", "wrong distributor", "known sum", "quote short", "service omitted", "required", "balance", "noncanonical", "false checks", "shared distributor", "isolated distributor"} {
			t.Run(mode+"/"+mutation, func(t *testing.T) {
				data, e := os.ReadFile("testdata/holders/" + mode + ".json")
				if e != nil {
					t.Fatal(e)
				}
				var b deployment.ObservationBatch
				if json.Unmarshal(data, &b) != nil {
					t.Fatal("decode")
				}
				markets := map[string]MarketReadModel{}
				for _, o := range b.Observations {
					if o.Kind == "market" {
						markets[o.Key] = MarketReadModel{MarketID: o.Key, QuoteAsset: o.Value["quoteAsset"].(string), MemeToken: o.Value["memeToken"].(string)}
					}
				}
				holders, e := BuildHolderCandidates(b, markets)
				if e != nil || len(holders) != 1 {
					t.Fatal("fixture", e)
				}
				var index int
				for i, o := range b.Observations {
					if o.Kind == "treasurySolvency" {
						index = i
					}
				}
				row := &b.Observations[index]
				v := row.Value
				add := func(field, amount string) { v[field] = feeTestAdd(t, v[field].(string), amount) }
				switch mutation {
				case "surplus":
					add("balance", "1")
				case "other treasury liability":
					add("totalQuoteLiability", "1")
					add("requiredBalance", "1")
					add("balance", "1")
				case "missing":
					b.Observations = append(b.Observations[:index], b.Observations[index+1:]...)
				case "duplicate":
					b.Observations = append(b.Observations, *row)
				case "wrong key":
					row.Key += "extra"
				case "wrong asset":
					v["asset"] = holders[0].MemeToken
				case "wrong distributor":
					v["treasuryDistributor"] = holders[0].MemeToken
				case "known sum":
					v["knownHolderMarketOutstanding"] = "0"
				case "quote short":
					v["totalQuoteLiability"] = "0"
				case "service omitted":
					delete(v, "totalServiceLiability")
				case "required":
					v["requiredBalance"] = "0"
				case "balance":
					v["balance"] = "0"
				case "noncanonical":
					v["balance"] = "09"
				case "false checks":
					v["checks"] = map[string]bool{"balanceCoversLiabilities": true}
					v["balance"] = "0"
				case "shared distributor":
					h := holders[0]
					h.MarketID = deployment.Hash([]byte("second holder market"))
					holders = append(holders, h)
					outstanding := v["knownHolderMarketOutstanding"].(string)
					for _, field := range []string{"knownHolderMarketOutstanding", "totalQuoteLiability", "requiredBalance", "balance"} {
						add(field, outstanding)
					}
				case "isolated distributor":
					h := holders[0]
					h.Distributor = h.MemeToken
					holders = append(holders, h)
				}
				valid := mutation == "valid" || mutation == "surplus" || mutation == "other treasury liability" || mutation == "shared distributor"
				if e := verifyStoredHolderSolvency(holders, b); (e == nil) != valid {
					t.Fatal(mutation, e)
				}
			})
		}
	}
	if e := verifyStoredHolderSolvency(nil, deployment.ObservationBatch{}); e != nil {
		t.Fatal(e)
	}
}

func TestHolderHistoricalServiceAssets(t *testing.T) {
	for _, mode := range []string{"pending", "current missing", "current zero", "policy conflict", "current asset", "finalized withdrawn", "missing", "short", "two pending short", "unrelated asset"} {
		t.Run(mode, func(t *testing.T) {
			distributor := "0x1111111111111111111111111111111111111111"
			quote := "0x2222222222222222222222222222222222222222"
			serviceAsset := "0x0000000000000000000000000000000000000000"
			status := "2"
			service := "5"
			if mode == "finalized withdrawn" {
				status = "3"
				service = "0"
			}
			h := HolderMarketCandidate{Mode: "epoch", Distributor: distributor, QuoteAsset: quote, Epoch: &EpochHolderCandidate{CurrentServiceFeeAsset: quote, CurrentServiceFeeAmount: "1", Entries: []HolderEpochDetail{{Values: map[string]string{"outstandingQuoteAmount": "7", "serviceFeeAsset": serviceAsset, "serviceFeeAmount": "5", "status": status}}}}}
			b := deployment.ObservationBatch{}
			for _, a := range []struct{ asset, q, s string }{{quote, "7", "0"}, {serviceAsset, "0", service}} {
				b.Observations = append(b.Observations, deployment.StateObservation{Kind: "treasurySolvency", Key: distributor + ":" + a.asset, Value: map[string]any{"treasuryDistributor": distributor, "asset": a.asset, "knownHolderMarketOutstanding": a.q, "totalQuoteLiability": a.q, "totalServiceLiability": a.s, "requiredBalance": feeTestAdd(t, a.q, a.s), "balance": feeTestAdd(t, a.q, a.s)}})
			}
			switch mode {
			case "current missing":
				h.Epoch.CurrentServiceFeeAsset = distributor
			case "current zero":
				h.Epoch.CurrentServiceFeeAmount = "0"
			case "policy conflict":
				other := h
				copyEpoch := *h.Epoch
				copyEpoch.CurrentServiceFeeAmount = "2"
				other.Epoch = &copyEpoch
				if verifyStoredHolderSolvency([]HolderMarketCandidate{h, other}, b) == nil {
					t.Fatal("conflicting policies accepted")
				}
				return
			case "current asset":
				h.Epoch.CurrentServiceFeeAsset = distributor
				b.Observations = append(b.Observations, deployment.StateObservation{Kind: "treasurySolvency", Key: distributor + ":" + distributor, Value: map[string]any{"treasuryDistributor": distributor, "asset": distributor, "knownHolderMarketOutstanding": "0", "totalQuoteLiability": "0", "totalServiceLiability": "1", "requiredBalance": "1", "balance": "1"}})
			case "missing":
				b.Observations = b.Observations[:1]
			case "short":
				for _, key := range []string{"totalServiceLiability", "requiredBalance", "balance"} {
					b.Observations[1].Value[key] = "4"
				}
			case "two pending short":
				h.Epoch.Entries = append(h.Epoch.Entries, h.Epoch.Entries[0])
				b.Observations[0].Value["knownHolderMarketOutstanding"] = "14"
				b.Observations[0].Value["totalQuoteLiability"] = "14"
				b.Observations[0].Value["requiredBalance"] = "14"
				b.Observations[0].Value["balance"] = "14"
			case "unrelated asset":
				b.Observations[1].Key = distributor + ":" + distributor
				b.Observations[1].Value["asset"] = distributor
			}
			valid := mode == "pending" || mode == "current asset" || mode == "finalized withdrawn"
			if e := verifyStoredHolderSolvency([]HolderMarketCandidate{h}, b); (e == nil) != valid {
				t.Fatal(mode, e)
			}
		})
	}
}

func TestHistoricalServiceAssetSolvencyInventory(t *testing.T) {
	data, err := os.ReadFile("testdata/holders/epoch.json")
	if err != nil {
		t.Fatal(err)
	}
	var batch deployment.ObservationBatch
	if json.Unmarshal(data, &batch) != nil {
		t.Fatal("fixture")
	}
	markets := map[string]MarketReadModel{}
	for _, o := range batch.Observations {
		if o.Kind == "market" {
			markets[o.Key] = MarketReadModel{MarketID: o.Key, QuoteAsset: o.Value["quoteAsset"].(string), MemeToken: o.Value["memeToken"].(string)}
		}
	}
	holders, err := BuildHolderCandidates(batch, markets)
	if err != nil || len(holders) != 1 {
		t.Fatal(err)
	}
	d := holders[0].Distributor
	asset := "0x6666666666666666666666666666666666666666"
	key := d + ":" + asset
	old := deployment.StateObservation{Kind: "treasurySolvency", Key: key, Value: map[string]any{"treasuryDistributor": d, "asset": asset, "knownHolderMarketOutstanding": "0", "totalQuoteLiability": "0", "totalServiceLiability": "3", "requiredBalance": "3", "balance": "3"}}
	batch.Observations = append(batch.Observations, old)
	if verifyStoredHolderSolvency(holders, batch) == nil {
		t.Fatal("unproven extra asset accepted")
	}
	history := map[string]*big.Int{key: big.NewInt(3)}
	if err := verifyStoredHolderSolvency(holders, batch, history); err != nil {
		t.Fatal("historical asset rejected", err)
	}
	old.Value["balance"] = "2"
	if verifyStoredHolderSolvency(holders, batch, history) == nil {
		t.Fatal("old asset insolvency accepted")
	}
	old.Value["balance"] = "3"
	batch.Observations = batch.Observations[:len(batch.Observations)-1]
	if verifyStoredHolderSolvency(holders, batch, history) == nil {
		t.Fatal("missing historical asset accepted")
	}
}
