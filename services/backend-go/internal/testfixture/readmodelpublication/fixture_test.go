package readmodelpublication

import (
	"testing"

	"tickergarden/backend/internal/readmodel"
)

func TestLoadBuildsSingleMarketPublicationInputs(t *testing.T) {
	fixture, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if fixture.ChainID != 46630 || fixture.BlockNumber != "0xa" || fixture.BlockHash == "" || fixture.TransactionHash == "" {
		t.Fatalf("unexpected base identity: %+v", fixture)
	}
	if len(fixture.Inputs) != 6 || fixture.Batch.Expected != len(fixture.Batch.Observations) || len(fixture.Batch.Observations) < 5 {
		t.Fatalf("incomplete fixture: inputs=%d expected=%d observations=%d", len(fixture.Inputs), fixture.Batch.Expected, len(fixture.Batch.Observations))
	}
	wantNames := []string{"AssetRegistered", "QuoteAssetConfigAdded", "TickerGardenBaselineAdded", "LaunchTemplateAdded", "MarketCreated", "FeeBucketsCredited"}
	for i, want := range wantNames {
		if fixture.EventNames[i] != want {
			t.Fatalf("event %d=%q want %q", i, fixture.EventNames[i], want)
		}
	}
	if fixture.Batch.Scope == "" || fixture.AssetUID == "" || fixture.QuoteConfigID == "" || fixture.QuoteAsset == "" || fixture.BaselineID == "" || fixture.TemplateID == "" || fixture.MarketID == "" || fixture.PoolID == "" {
		t.Fatalf("missing fixture identifiers: %+v", fixture)
	}
	for _, input := range fixture.Inputs {
		if input.ChainID != fixture.ChainID || input.Log.BlockNumber != fixture.BlockNumber || input.Log.BlockHash != fixture.BlockHash || input.Log.TransactionHash != fixture.TransactionHash || input.Log.Removed {
			t.Fatalf("input is not bound to fixture block: %+v", input)
		}
	}
}

func TestFullObservationBatchBuildsSingleMarketCandidate(t *testing.T) {
	fixture, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	candidate, err := readmodel.BuildCandidateSet(fixture.FullObservationBatch, fixture.Sources)
	if err != nil {
		t.Fatal(err)
	}
	if candidate.ChainID != fixture.ChainID || len(candidate.Markets) != 1 || candidate.Markets[0].MarketID != fixture.MarketID || len(candidate.Configs) != 4 {
		t.Fatalf("unexpected candidate identity: %+v", candidate)
	}
	if len(candidate.CreatorEpochs) != 1 || candidate.CreatorEpochs[0].MarketID != fixture.MarketID || candidate.CreatorEpochs[0].QuoteLiability != "1" || candidate.CreatorEpochs[0].MemeLiability != "0" {
		t.Fatalf("creator epoch evidence missing: %+v", candidate.CreatorEpochs)
	}
	for _, asset := range []string{fixture.QuoteAsset, fixture.MemeToken} {
		found := false
		for _, observation := range fixture.FullObservationBatch.Observations {
			if observation.Kind == "feeLiability" && observation.Key == fixture.MarketID+":"+asset {
				found = true
				if observation.Value["marketId"] != fixture.MarketID || observation.Value["feeAsset"] != asset || observation.Value["feeVault"] == nil {
					t.Fatalf("fee liability binding mismatch: %+v", observation)
				}
			}
		}
		if !found {
			t.Fatalf("missing fee liability for %s", asset)
		}
	}
}
