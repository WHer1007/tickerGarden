package readmodel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/operations"
	"tickergarden/backend/internal/postgres"
	"time"
)

func TestCreatorCandidatePostgres(t *testing.T) {
	if os.Getenv("TG_TEST_CREATOR_CANDIDATE") != "1" {
		t.Skip("set TG_TEST_CREATOR_CANDIDATE=1")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TG_TEST_DATABASE_URL required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid database URL")
	}
	admin, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal("database unavailable")
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_creator_candidate_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, e := admin.Exec(cleanup, "DROP DATABASE "+quoted+" WITH (FORCE)"); e != nil {
			t.Error(e)
		}
	}()
	dbCfg := cfg.Copy()
	dbCfg.Database = name
	db := stdlib.OpenDB(*dbCfg)
	defer db.Close()
	migrations, err := migration.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = migrations.Up(ctx); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	pool, err := postgres.Open(ctx, u.String(), 4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}

	b, sources := fullCandidateFixture(t)
	base, e := BuildCandidateSet(b, sources)
	if e != nil {
		t.Fatal(e)
	}
	m := base.Markets[0]
	for _, epoch := range []string{"1", "2"} {
		b.Observations = append(b.Observations, deployment.StateObservation{Kind: "creatorEpoch", Key: m.MarketID + ":" + epoch, Value: map[string]any{"marketId": m.MarketID, "epoch": epoch, "beneficiary": m.MemeToken, "quoteAsset": m.QuoteAsset, "memeAsset": m.MemeToken, "quoteLiability": "900719925474099312345", "memeLiability": "0", "rawRewardExitAt": "100", "rawRewardExitReady": true, "observedAtTimestamp": "100"}})
	}
	for _, a := range []struct{ asset, total string }{{m.QuoteAsset, "1801439850948198624690"}, {m.MemeToken, "0"}} {
		b.Observations = append(b.Observations, deployment.StateObservation{Kind: "feeLiability", Key: m.MarketID + ":" + a.asset, Value: map[string]any{"marketId": m.MarketID, "feeAsset": a.asset, "creatorEpochCount": "2", "creator": a.total, "staker": "20", "platform": "0", "holder": "0", "forfeitureReserve": "0", "feeVault": m.MemeToken, "bucketAndReserveTotal": feeTestAdd(t, a.total, "20")}})
		b.Observations = append(b.Observations, deployment.StateObservation{Kind: "feeSolvency", Key: a.asset, Value: map[string]any{"feeAsset": a.asset, "feeVault": m.MemeToken, "totalLiability": feeTestAdd(t, a.total, "20"), "knownMarketLiabilitySum": feeTestAdd(t, a.total, "20"), "balance": feeTestAdd(t, a.total, "20")}})
	}
	b.Expected = len(b.Observations)
	b.Scope = "market-curve-gauge-vault-fees-holder-config-route-accounts-gauge-principal-v1"
	height, e := strconv.ParseUint(b.BlockNumber, 0, 64)
	if e != nil {
		t.Fatal(e)
	}
	genesis := "0x" + strings.Repeat("a", 64)
	manifest := "0x" + strings.Repeat("b", 64)
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES($1,$2,$3,$3,$4,$3,$4)`, b.ChainID, genesis, height, b.BlockHash)
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES($1,$2,$3,$4,100,true)`, b.ChainID, height, b.BlockHash, genesis)
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES($1,$2,$3,$3,$4)`, b.ChainID, manifest, height, b.BlockHash)
	exec(`INSERT INTO tickergarden.projection_checkpoints(chain_id,manifest_hash,projector_version,start_block,tip_number,tip_hash) VALUES($1,$2,'creator-test',$3,$3,$4)`, b.ChainID, manifest, height, b.BlockHash)
	persist := func(batch deployment.ObservationBatch) {
		t.Helper()
		payload, e := json.Marshal(batch)
		if e != nil {
			t.Fatal(e)
		}
		exec(`DELETE FROM tickergarden.projection_block_observations WHERE chain_id=$1`, batch.ChainID)
		exec(`DELETE FROM tickergarden.projection_observation_batches WHERE chain_id=$1`, batch.ChainID)
		exec(`INSERT INTO tickergarden.projection_observation_batches(chain_id,block_hash,scope,expected_count,completed_count,payload,digest) VALUES($1,$2,$3,$4,$4,$5,$6)`, batch.ChainID, batch.BlockHash, batch.Scope, batch.Expected, payload, deployment.Hash(payload))
		for _, o := range batch.Observations {
			v, e := json.Marshal(o.Value)
			if e != nil {
				t.Fatal(e)
			}
			exec(`INSERT INTO tickergarden.projection_block_observations(chain_id,block_hash,kind,observation_key,value) VALUES($1,$2,$3,$4,$5)`, batch.ChainID, batch.BlockHash, o.Kind, o.Key, v)
		}
	}
	store := ObservationStore{Pool: pool, ChainID: b.ChainID, GenesisHash: genesis, ManifestHash: manifest, Version: "creator-test", Scope: b.Scope, StartBlock: height}
	persist(b)
	loaded, e := store.LoadCandidateBatch(ctx)
	if e != nil {
		t.Fatal(e)
	}
	got, e := BuildCandidateSet(loaded, sources)
	if e != nil || len(got.CreatorEpochs) != 2 || got.CreatorEpochs[0].QuoteLiability != "900719925474099312345" {
		t.Fatal(got, e)
	}
	if e := verifyStoredFeeCoverage(got, loaded); e != nil {
		t.Fatal(e)
	}
	// Matching payload digests/mirrors do not prove financial consistency.
	for _, field := range []string{"balance", "totalLiability", "knownMarketLiabilitySum", "staker", "bucketAndReserveTotal"} {
		for i := range b.Observations {
			row := &b.Observations[i]
			if _, ok := row.Value[field]; !ok {
				continue
			}
			previous := row.Value[field]
			row.Value[field] = "0"
			persist(b)
			changed, err := store.LoadCandidateBatch(ctx)
			if err != nil {
				t.Fatal("valid storage encoding rejected", err)
			}
			if verifyStoredFeeCoverage(got, changed) == nil {
				t.Fatal("financial mismatch accepted", field)
			}
			row.Value[field] = previous
			break
		}
	}
	persist(b)
	// A mirror-only edit must fail persistence consistency checks.
	exec(`UPDATE tickergarden.projection_block_observations SET value=jsonb_set(value,'{quoteLiability}','"1"') WHERE kind='creatorEpoch'`)
	if _, e := store.LoadCandidateBatch(ctx); e == nil {
		t.Fatal("mirror tamper accepted")
	}
	persist(b)
	// Even with a recomputed payload digest and matching mirror, a missing epoch fails assembly.
	var removed deployment.StateObservation
	for i, o := range b.Observations {
		if o.Kind == "creatorEpoch" && o.Value["epoch"] == "2" {
			removed = o
			b.Observations = append(b.Observations[:i], b.Observations[i+1:]...)
			break
		}
	}
	b.Expected = len(b.Observations)
	persist(b)
	loaded, e = store.LoadCandidateBatch(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e := BuildCandidateSet(loaded, sources); e == nil {
		t.Fatal("missing persisted epoch accepted")
	}
	b.Observations = append(b.Observations, removed)
	b.Expected = len(b.Observations)
	persist(b)
	loaded, e = store.LoadCandidateBatch(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if got, e := BuildCandidateSet(loaded, sources); e != nil || len(got.CreatorEpochs) != 2 {
		t.Fatal("restored batch unavailable", e)
	}
	testPersistedHolderCandidates(t, ctx, store, b, sources, persist, exec)
	testMarketCandidateReplay(t, ctx, store, b, persist, exec)

	var statusOut, statusErr bytes.Buffer
	statusEnv := func(key string) string {
		switch key {
		case "TG_STATUS_DATABASE_URL":
			return u.String()
		case "TG_CHAIN_ID":
			return strconv.FormatUint(b.ChainID, 10)
		}
		return ""
	}
	statusCode := operations.Run(ctx, []string{"--once", "--prometheus"}, statusEnv, &statusOut, &statusErr)
	if statusCode != 2 || statusErr.Len() != 0 || !strings.Contains(statusOut.String(), `tickergarden_pipeline_stage_present{chain_id="46630",stage="publication"} 0`) || !strings.Contains(statusOut.String(), `tickergarden_pipeline_stage_present{chain_id="46630",stage="projection"} 1`) {
		t.Fatal("pipeline metrics CLI", statusCode, statusOut.String(), statusErr.String())
	}
	metricsPath := filepath.Join(t.TempDir(), "pipeline.prom")
	statusOut.Reset()
	statusErr.Reset()
	statusCode = operations.Run(ctx, []string{"--once", "--metrics-file", metricsPath}, statusEnv, &statusOut, &statusErr)
	metricsData, metricsErr := os.ReadFile(metricsPath)
	if statusCode != 2 || statusOut.Len() != 0 || statusErr.Len() != 0 || metricsErr != nil || !bytes.Contains(metricsData, []byte(`tickergarden_pipeline_attention{chain_id="46630"} 1`)) {
		t.Fatal("attention report was not delivered to metrics file", statusCode, metricsErr, statusErr.String())
	}
	statusCode = operations.Run(ctx, []string{"--once", "--metrics-file", metricsPath}, func(key string) string {
		if key == "TG_STATUS_DATABASE_URL" {
			return "postgres://invalid:invalid@127.0.0.1:1/invalid?sslmode=disable"
		}
		return statusEnv(key)
	}, &statusOut, &statusErr)
	retained, retainErr := os.ReadFile(metricsPath)
	if statusCode != 1 || retainErr != nil || !bytes.Equal(retained, metricsData) || statusOut.Len() != 0 {
		t.Fatal("database failure replaced previous metrics", statusCode, retainErr)
	}

}
