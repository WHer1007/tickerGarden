package readmodel

import (
	"encoding/json"
	"math/big"
	"os"
	"strconv"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/feeledger"
	"tickergarden/backend/internal/projection"
)

func feeReconciliationFixture(t *testing.T) (CandidateSet, deployment.ObservationBatch, string, []feeledger.Input) {
	t.Helper()
	raw, err := os.ReadFile("../projection/testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct{ Input projection.Input }
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		d, err := events.Decode(f.Input.Module, f.Input.Log)
		if err != nil || !strings.HasPrefix(d.Signature, "FeeBucketsCredited(") {
			continue
		}
		log := f.Input.Log
		height, _ := strconv.ParseUint(log.BlockNumber, 0, 64)
		id := d.Args["marketId"].(string)
		asset := d.Args["feeAsset"].(string)
		meme := "0x" + strings.Repeat("e", 40)
		c := CandidateSet{ChainID: f.Input.ChainID, BlockNumber: strconv.FormatUint(height, 10), BlockHash: log.BlockHash, HistoryStartBlock: height, HistoryReceiptRootsVerified: true, ProtocolEventInventoryVerified: true, EmitterAddressBindingsVerified: true, Markets: []MarketReadModel{{MarketID: id, MemeToken: meme, QuoteAsset: asset}}}
		b := deployment.ObservationBatch{ChainID: c.ChainID, BlockNumber: log.BlockNumber, BlockHash: log.BlockHash}
		for _, a := range []string{asset, meme} {
			values := map[string]any{"marketId": id, "feeAsset": a, "feeVault": log.Address, "holder": "0", "forfeitureReserve": "0"}
			total := new(big.Int)
			for _, field := range []string{"creator", "staker", "platform"} {
				amount := "0"
				if a == asset {
					amount = d.Args[field+"Amount"].(string)
				}
				values[field] = amount
				n, _ := new(big.Int).SetString(amount, 10)
				total.Add(total, n)
			}
			values["bucketAndReserveTotal"] = total.String()
			b.Observations = append(b.Observations, deployment.StateObservation{Kind: "feeLiability", Key: id + ":" + a, Value: values}, deployment.StateObservation{Kind: "feeSolvency", Key: a, Value: map[string]any{"feeAsset": a, "feeVault": log.Address, "totalLiability": total.String(), "knownMarketLiabilitySum": total.String(), "balance": total.String()}})
		}
		b.Expected = len(b.Observations)
		return c, b, log.Address, []feeledger.Input{{Module: f.Input.Module, Log: log}}
	}
	t.Fatal("missing credit")
	return CandidateSet{}, deployment.ObservationBatch{}, "", nil
}

func TestFeeReconciliationCandidate(t *testing.T) {
	for _, mode := range []string{"matched", "continuous holder", "epoch holder", "invalid holder", "mismatch", "missing roots", "missing inventory", "missing emitter", "missing vault", "wrong chain", "wrong block", "wrong height", "outside range", "duplicate log", "invalid replay", "reverse transactions"} {
		t.Run(mode, func(t *testing.T) {
			c, b, vault, inputs := feeReconciliationFixture(t)
			want := "unavailable"
			switch mode {
			case "matched":
				want = "matched"
			case "continuous holder", "epoch holder", "invalid holder":
				want = "matched"
				m := c.Markets[0]
				holderMode := "continuous-24h"
				if mode == "epoch holder" {
					holderMode = "epoch"
				}
				if mode == "invalid holder" {
					holderMode = "wrong"
					want = "unavailable"
				}
				c.HolderMarkets = []HolderMarketCandidate{{MarketID: m.MarketID, Distributor: "0x" + strings.Repeat("d", 40), MemeToken: m.MemeToken, QuoteAsset: m.QuoteAsset, Mode: holderMode}}
			case "mismatch":
				want = "mismatch"
				b.Observations[0].Value["creator"] = "999"
			case "missing roots":
				c.HistoryReceiptRootsVerified = false
			case "missing inventory":
				c.ProtocolEventInventoryVerified = false
			case "missing emitter":
				c.EmitterAddressBindingsVerified = false
			case "missing vault":
				vault = ""
			case "wrong chain":
				b.ChainID++
			case "wrong block":
				b.BlockHash = "0x" + strings.Repeat("a", 64)
			case "wrong height":
				b.BlockNumber = "0xffff"
			case "outside range":
				inputs[0].Log.BlockNumber = "0xffff"
			case "duplicate log":
				inputs = append(inputs, inputs[0])
			case "invalid replay":
				inputs[0].Log.Address = "0x" + strings.Repeat("e", 40)
			case "reverse transactions":
				second := inputs[0]
				second.Log.TransactionHash = "0x" + strings.Repeat("f", 64)
				second.Log.TransactionIndex = "0x0"
				second.Log.LogIndex = "0xffff"
				inputs[0].Log.TransactionIndex = "0x1"
				inputs = append(inputs, second)
			}
			got := buildFeeReconciliation(c, b, vault, inputs)
			if got.Status != want || got.BlockHash != c.BlockHash {
				t.Fatal(mode, got)
			}
			if want == "unavailable" {
				if got.Report != nil || got.Reason == "" {
					t.Fatal("partial evidence", got)
				}
			} else if got.Report == nil || got.Report.HistoryComplete || got.Report.PublicationEligible || got.Report.MatchesKnownLiabilities != (want == "matched") {
				t.Fatal(got)
			}
		})
	}
}
