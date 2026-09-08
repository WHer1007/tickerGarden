package integration

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/treasury"
)

func testTreasuryReview(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string, rpc *requestDiscoveryRPC) {
	t.Helper()
	candidate, err := treasury.ReadCandidate(ctx, pool, id)
	if err != nil {
		t.Fatal(err)
	}
	report := treasury.HistoryReport{CandidateID: id, InputDigest: treasury.InputDigest(candidate.Input), HistoryComplete: true, Method: "fixture independent source inspection", Evidence: "isolated PostgreSQL receipt/log range and independently supplied dataset fixture"}
	if _, err = treasury.RecordReview(ctx, pool, pool, rpc, rpc.manifest, id, hash(970), candidate.Dataset, report, "approved", "fixture review"); err == nil {
		t.Fatal("candidate author self-approved")
	}
	// A separate temporary database login proves actor separation in PostgreSQL.
	role := fmt.Sprintf("tg_review_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{role}.Sanitize()
	const password = "isolated-test-review-password"
	if _, err = pool.Exec(ctx, "CREATE ROLE "+identifier+" LOGIN PASSWORD '"+password+"'"); err != nil {
		t.Fatal("cannot create isolated reviewer", err)
	}
	var reviewer *pgxpool.Pool
	defer func() {
		if reviewer != nil {
			reviewer.Close()
		}
		if _, e := pool.Exec(context.Background(), "DROP OWNED BY "+identifier); e != nil {
			t.Error(e)
		}
		if _, e := pool.Exec(context.Background(), "DROP ROLE "+identifier); e != nil {
			t.Error(e)
		}
	}()
	for _, sql := range []string{"GRANT USAGE ON SCHEMA tickergarden TO " + identifier, "GRANT SELECT ON ALL TABLES IN SCHEMA tickergarden TO " + identifier, "GRANT INSERT ON tickergarden.treasury_reviews TO " + identifier, "GRANT USAGE ON ALL SEQUENCES IN SCHEMA tickergarden TO " + identifier} {
		if _, err = pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	cfg := pool.Config().Copy()
	cfg.ConnConfig.User = role
	cfg.ConnConfig.Password = password
	reviewer, err = pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err = reviewer.Ping(ctx); err != nil {
		t.Fatal("separate reviewer login failed", err)
	}
	// Historical fixtures cannot be approved as a current request until RPC is fresh.
	if _, err = treasury.RecordReview(ctx, reviewer, pool, rpc, rpc.manifest, id, hash(970), candidate.Dataset, report, "approved", "fixture review"); err == nil {
		t.Fatal("stale RPC approved")
	}
	now := uint64(time.Now().Unix())
	rpc.block.Number = "0x4"
	rpc.block.Hash = hash(950)
	rpc.block.Timestamp = fmt.Sprintf("0x%x", now)
	key := candidate.Input.Distributor + deployment.Hash([]byte("epoch(bytes32,uint32)"))[:10] + candidate.Input.MarketID[2:] + fmt.Sprintf("%064x", candidate.Input.EpochID)
	requested, _ := hex.DecodeString(fmt.Sprintf("%064x", now-10))
	publishBy, _ := hex.DecodeString(fmt.Sprintf("%064x", now+300))
	copy(rpc.calls[key][:32], requested)
	copy(rpc.calls[key][32:64], publishBy)
	bad := candidate.Dataset
	bad.MerkleRoot = hash(999)
	if _, err = treasury.RecordReview(ctx, reviewer, pool, rpc, rpc.manifest, id, hash(970), bad, report, "approved", "fixture mismatch"); err == nil {
		t.Fatal("mismatching reference approved")
	}
	approved, err := treasury.RecordReview(ctx, reviewer, pool, rpc, rpc.manifest, id, hash(970), candidate.Dataset, report, "approved", "fixture review")
	if err != nil {
		t.Fatal("independent approval failed", err)
	}
	got, err := treasury.LatestReview(ctx, reviewer, id)
	if err != nil || got.Decision != "approved" || got.Reviewer != role || !got.ReferenceMatched || !got.JournalReplayed || !got.ReceiptRootVerified || got.ObservedBlockHash != rpc.block.Hash {
		t.Fatal("review provenance incorrect", got, err)
	}

	if _, e := treasury.RecordReview(ctx, reviewer, pool, rpc, rpc.manifest, id, hash(970), candidate.Dataset, report, "approved", "changed decision reason"); e == nil {
		t.Fatal("review operation ID repurposed")
	}
	publisher := fmt.Sprintf("0x%040x", 990)
	sim := &reviewSimulationRPC{requestDiscoveryRPC: rpc, publisher: publisher}
	plan, e := treasury.PreparePublication(ctx, pool, sim, rpc.manifest, id, publisher)
	if e != nil || plan.Status != "simulated_unsigned" || plan.TransactionSubmission || plan.ReviewID != approved || plan.To != candidate.Input.Distributor || plan.From != publisher || plan.Data != sim.data || plan.Value != "0x0" {
		t.Fatal("publication preparation failed", plan, e)
	}
	if _, e = treasury.PreparePublication(ctx, reviewer, sim, rpc.manifest, id, publisher); e == nil {
		t.Fatal("reviewer also prepared publication")
	}
	sim.revert = true
	if _, e = treasury.PreparePublication(ctx, pool, sim, rpc.manifest, id, publisher); e == nil {
		t.Fatal("reverting publisher accepted")
	}
	sim.revert = false
	sim.reorg = true
	if _, e = treasury.PreparePublication(ctx, pool, sim, rpc.manifest, id, publisher); e == nil {
		t.Fatal("late publication reorg accepted")
	}
	sim.reorg = false
	rpc.reorgAt = 0
	testTreasuryLifecycle(t, ctx, pool, id, rpc, key, publisher, now)
	rejected, err := treasury.RecordReview(ctx, reviewer, nil, nil, rpc.manifest, id, hash(971), treasury.Output{}, report, "rejected", "additional evidence requires rejection")
	if err != nil || rejected == approved {
		t.Fatal("rejection not recorded", err)
	}
	rpc.block.Timestamp = fmt.Sprintf("0x%x", now+1)
	replay, err := treasury.RecordReview(ctx, reviewer, pool, rpc, rpc.manifest, id, hash(970), candidate.Dataset, report, "approved", "fixture review")
	if err != nil || replay != approved {
		t.Fatal("review retry not idempotent", err)
	}
	got, err = treasury.LatestReview(ctx, reviewer, id)
	if err != nil || got.Decision != "rejected" {
		t.Fatal("old approval replaced rejection", got, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.treasury_reviews SET decision='approved' WHERE id=$1`, rejected); err == nil {
		t.Fatal("review record mutable")
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.treasury_reviews WHERE candidate_id=$1`, id).Scan(&count); err != nil || count != 2 {
		t.Fatal("review history incorrect", count, err)
	}

	if _, e := treasury.PreparePublication(ctx, pool, sim, rpc.manifest, id, publisher); e == nil {
		t.Fatal("rejected candidate prepared for publication")
	}
	if _, e := treasury.PrepareFinalization(ctx, pool, sim, rpc.manifest, id, publisher); e == nil {
		t.Fatal("rejected candidate prepared for finalization")
	}
	// Direct insertion by the author is also rejected by the database trigger.
	if _, err = pool.Exec(ctx, `INSERT INTO tickergarden.treasury_reviews(id,candidate_id,decision,payload,operation_id) VALUES($1,$2,'approved',$3,$4)`, hash(952), id, []byte("{}"), hash(972)); err == nil {
		t.Fatal("database author separation bypassed")
	}
	// A digest-valid legacy approval without root evidence must not authorize
	// either operation, even though every other approval field remains valid.
	var legacyRaw []byte
	if err = pool.QueryRow(ctx, `SELECT payload FROM tickergarden.treasury_reviews WHERE id=$1`, approved).Scan(&legacyRaw); err != nil {
		t.Fatal(err)
	}
	var legacy treasury.Review
	if json.Unmarshal(legacyRaw, &legacy) != nil {
		t.Fatal("legacy fixture")
	}
	legacy.OperationID = hash(973)
	legacy.ReceiptRootVerified = false
	legacyRaw, _ = json.Marshal(legacy)
	if _, err = reviewer.Exec(ctx, `INSERT INTO tickergarden.treasury_reviews(id,candidate_id,decision,payload,operation_id) VALUES($1,$2,'approved',$3,$4)`, deployment.Hash(legacyRaw), id, legacyRaw, legacy.OperationID); err != nil {
		t.Fatal(err)
	}
	if _, err = treasury.PreparePublication(ctx, pool, sim, rpc.manifest, id, publisher); err == nil || err.Error() != "current review does not authorize this candidate and manifest" {
		t.Fatal("legacy rootless publication", err)
	}
	if _, err = treasury.PrepareFinalization(ctx, pool, sim, rpc.manifest, id, publisher); err == nil || err.Error() != "current review does not authorize finalization" {
		t.Fatal("legacy rootless finalization", err)
	}
}

type reviewSimulationRPC struct {
	*requestDiscoveryRPC
	publisher, data string
	revert, reorg   bool
}

func (r *reviewSimulationRPC) SimulateAt(_ context.Context, from, to, data, blockHash string) ([]byte, error) {
	if r.revert || from != r.publisher || blockHash != r.block.Hash || to == "" || len(data) != 458 || !strings.HasPrefix(data, deployment.Hash([]byte("publishRoot(bytes32,uint32,bytes32,bytes32,uint256,uint32,uint256)"))[:10]) {
		return nil, errors.New("simulation denied")
	}
	r.data = data
	if r.reorg {
		r.reorgAt = r.headers + 1
	}
	return []byte{}, nil
}
