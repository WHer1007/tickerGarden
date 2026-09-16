package readmodel

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"tickergarden/backend/internal/deployment"
)

// Invoked by the isolated Creator database suite to reuse its migrated database.
// Registry identity is adapted to the full candidate fixture; it is not a replay
// of the export fixture's deployment history.
func testPersistedHolderCandidates(t *testing.T, ctx context.Context, store ObservationStore, base deployment.ObservationBatch, sources map[string]SourceBlock, persist func(deployment.ObservationBatch), exec func(string, ...any)) {
	t.Helper()
	original, e := BuildCandidateSet(base, sources)
	if e != nil {
		t.Fatal(e)
	}
	m := original.Markets[0]
	for _, mode := range []string{"epoch", "continuous"} {
		t.Run("persisted Holder/"+mode, func(t *testing.T) {
			data, e := os.ReadFile("testdata/holders/" + mode + ".json")
			if e != nil {
				t.Fatal(e)
			}
			var fixture deployment.ObservationBatch
			if e := json.Unmarshal(data, &fixture); e != nil {
				t.Fatal(e)
			}
			batch := base
			batch.Observations = append([]deployment.StateObservation{}, base.Observations...)
			for i, o := range batch.Observations {
				if o.Kind == "market" && o.Key == m.MarketID {
					values := map[string]any{}
					for k, v := range o.Value {
						values[k] = v
					}
					values["creatorFeesToHolders"] = true
					batch.Observations[i].Value = values
				}
			}
			for _, o := range fixture.Observations {
				if o.Kind == "treasurySolvency" {
					o.Value["asset"] = m.QuoteAsset
					o.Key = o.Value["treasuryDistributor"].(string) + ":" + m.QuoteAsset
					batch.Observations = append(batch.Observations, o)
					continue
				}
				if o.Kind != "holderMarket" && o.Kind != "holderEpoch" {
					continue
				}
				o.Value["marketId"] = m.MarketID
				for _, k := range []string{"memeToken", "token", "memeAsset"} {
					if _, ok := o.Value[k]; ok {
						o.Value[k] = m.MemeToken
					}
				}
				for _, k := range []string{"quoteToken", "quote", "quoteAsset", "currentServiceFeeAsset"} {
					if _, ok := o.Value[k]; ok {
						o.Value[k] = m.QuoteAsset
					}
				}
				o.Key = m.MarketID
				if o.Kind == "holderEpoch" {
					o.Key += ":" + o.Value["epoch"].(string)
				}
				batch.Observations = append(batch.Observations, o)
			}
			batch.Expected = len(batch.Observations)
			want, e := BuildCandidateSet(batch, sources)
			if e != nil || len(want.HolderMarkets) != 1 {
				t.Fatal("fixture", e)
			}
			check := func(valid bool) {
				t.Helper()
				loaded, e := store.LoadCandidateBatch(ctx)
				if e != nil {
					t.Fatal(e)
				}
				got, e := BuildCandidateSet(loaded, sources)
				if e == nil {
					e = verifyStoredHolderSolvency(got.HolderMarkets, loaded)
				}
				if (e == nil) != valid {
					t.Fatal("Holder persisted assembly", e)
				}
				if valid && !reflect.DeepEqual(got.HolderMarkets, want.HolderMarkets) {
					t.Fatal("Holder roundtrip differs", got.HolderMarkets, want.HolderMarkets)
				}
			}
			persist(batch)
			check(true)
			for i := range batch.Observations {
				row := &batch.Observations[i]
				if row.Kind != "treasurySolvency" {
					continue
				}
				old := row.Value["balance"]
				row.Value["balance"] = "0"
				persist(batch)
				check(false)
				row.Value["balance"] = old
				persist(batch)
				check(true)
				break
			}
			exec(`UPDATE tickergarden.projection_block_observations SET value=jsonb_set(value,'{treasuryDistributor}','"0x0000000000000000000000000000000000000000"') WHERE kind='holderMarket'`)
			if _, e := store.LoadCandidateBatch(ctx); e == nil {
				t.Fatal("Holder mirror tamper accepted")
			}
			persist(batch)
			check(true)
			// Synchronize payload, digest and mirror; domain validation still must fail.
			broken := batch
			broken.Observations = append([]deployment.StateObservation{}, batch.Observations...)
			if mode == "epoch" {
				for i, o := range broken.Observations {
					if o.Kind == "holderEpoch" {
						broken.Observations = append(broken.Observations[:i], broken.Observations[i+1:]...)
						break
					}
				}
			} else {
				for i, o := range broken.Observations {
					if o.Kind == "holderMarket" {
						v := map[string]any{}
						for key, value := range o.Value {
							v[key] = value
						}
						v["paid"] = "4"
						broken.Observations[i].Value = v
					}
				}
			}
			broken.Expected = len(broken.Observations)
			persist(broken)
			check(false)
			persist(batch)
			check(true)
		})
	}
}
