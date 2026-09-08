package deployment

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"time"
)

func TestContinuousHolderLiveObservation(t *testing.T) {
	file := os.Getenv("TG_CONTINUOUS_OBSERVER_FIXTURE")
	if file == "" {
		t.Skip("explicit public-chain fixture required")
	}
	raw, e := os.ReadFile(file)
	if e != nil {
		t.Fatal(e)
	}
	var input struct {
		Manifest    Manifest                   `json:"manifest"`
		Markets     map[string]MarketDiscovery `json:"markets"`
		BlockNumber string                     `json:"blockNumber"`
		BlockHash   string                     `json:"blockHash"`
	}
	if e = json.Unmarshal(raw, &input); e != nil {
		t.Fatal(e)
	}
	if input.Manifest.ChainID != 421614 {
		t.Fatal("testnet only")
	}
	endpoint := os.Getenv("TG_CONTINUOUS_RPC_URL")
	if endpoint == "" {
		endpoint = "https://sepolia-rollup.arbitrum.io/rpc"
	}
	rpc, e := chainrpc.New(endpoint)
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	block, e := rpc.Header(ctx, input.BlockNumber)
	if e != nil {
		t.Fatal(e)
	}
	if block.Hash != input.BlockHash {
		t.Fatal("fixture block changed")
	}
	batch, e := ObserveHolderBlock(ctx, rpc, input.Manifest, block, input.Markets)
	if e != nil {
		t.Fatal(e)
	}
	count := 0
	for _, r := range batch.Observations {
		if r.Value["rewardMode"] != "continuous-24h" {
			t.Fatal("incorrect mode")
		}
		if r.Kind == "holderMarket" {
			count++
		}
		if r.Kind == "treasurySolvency" {
			if r.Value["checks"].(map[string]bool)["balanceCoversLiabilities"] != true {
				t.Fatal("insolvent")
			}
		}
	}
	if count != len(input.Markets) || batch.Expected != len(batch.Observations) {
		t.Fatal("missing observations")
	}
	data, _ := json.MarshalIndent(batch, "", "  ")
	if dest := os.Getenv("TG_CONTINUOUS_OBSERVER_OUTPUT"); dest != "" {
		if e = os.WriteFile(dest, append(data, '\n'), 0600); e != nil {
			t.Fatal(e)
		}
	}
	t.Logf("Verified %d continuous markets, %d total canonical observations at %s", count, batch.Expected, block.Number)
}
