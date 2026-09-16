package integration

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/treasury"
)

func testTreasuryRecovery(t *testing.T, ctx context.Context, pool *pgxpool.Pool, c treasury.Candidate, rpc *requestDiscoveryRPC) {
	t.Helper()
	q := treasury.JobQueue{Pool: pool}
	in := c.Input
	in.Transfers = []treasury.Transfer{}
	in.QuoteAmount = "1001"
	id, err := q.Enqueue(ctx, treasury.JobSpec{Input: in, Manifest: rpc.manifest})
	if err != nil {
		t.Fatal(err)
	}
	exhaust := func() treasury.Job {
		t.Helper()
		var last treasury.Job
		for i := 1; i <= 5; i++ {
			if _, e := pool.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET available_at=now() WHERE id=$1`, id); e != nil {
				t.Fatal(e)
			}
			j, e := q.Claim(ctx, rpc.manifest)
			if e != nil || j.ID != id || j.Attempts != i {
				t.Fatal("recovery fixture claim", j, e)
			}
			if e = q.Fail(ctx, j); e != nil {
				t.Fatal(e)
			}
			last = j
		}
		return last
	}
	old := exhaust()
	history, err := q.History(ctx, id, 0)
	if err != nil || len(history) != 11 || history[0].Event != "enqueued" || history[10].Event != "exhausted" {
		t.Fatal("audit lifecycle missing", history, err)
	}
	var actor string
	if err = pool.QueryRow(ctx, `SELECT session_user`).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	for _, event := range history {
		if event.Actor != actor || event.RecoveryCount != 0 {
			t.Fatal("wrong database audit actor", event)
		}
	}
	page, err := q.History(ctx, id, history[5].Sequence)
	if err != nil || len(page) != 5 || page[0].Sequence <= history[5].Sequence {
		t.Fatal("audit pagination", page, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.treasury_job_audit SET event_type='forged' WHERE job_id=$1`, id); err == nil {
		t.Fatal("audit mutable")
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET state='ready',attempts=0 WHERE id=$1`, id); err == nil {
		t.Fatal("unrecorded recovery permitted")
	}
	if _, err = q.Recover(ctx, jobFailRPC{}, id, hash(940), "RPC repaired", 0); err == nil {
		t.Fatal("RPC failure authorized recovery")
	}
	key := in.Distributor + deployment.Hash([]byte("epoch(bytes32,uint32)"))[:10] + in.MarketID[2:] + fmt.Sprintf("%064x", in.EpochID)
	rpc.calls[key][7*32-1] = 1
	// Contract observation still commits 1000, while the frozen job asks for 1001.
	if _, err = q.Recover(ctx, rpc, id, hash(940), "RPC repaired", 0); err == nil {
		t.Fatal("mismatched frozen request recovered")
	}
	// Configure a matching REQUESTED snapshot for this recovery scenario.
	rpc.calls[key][7*32-1] = 1
	amount, _ := hex.DecodeString(fmt.Sprintf("%064x", 1001))
	copy(rpc.calls[key][13*32:14*32], amount)
	funded := in.Distributor + deployment.Hash([]byte("epochQuoteAmount(bytes32,uint32)"))[:10] + in.MarketID[2:] + fmt.Sprintf("%064x", in.EpochID)
	rpc.calls[funded] = amount
	receipt, err := q.Recover(ctx, rpc, id, hash(940), "RPC repaired", 0)
	if err != nil || receipt.RecoveryCount != 1 {
		t.Fatal("recovery failed", receipt, err)
	}
	status, err := q.Status(ctx, id)
	if err != nil || status.State != "ready" || status.RecoveryCount != 1 || status.Attempts != 0 {
		t.Fatal(status, err)
	}
	if err = q.Fail(ctx, old); !errors.Is(err, treasury.ErrLeaseLost) {
		t.Fatal("old worker modified recovered generation", err)
	}
	again, err := q.Recover(ctx, jobFailRPC{}, id, hash(940), "RPC repaired", 0)
	if err != nil || again != receipt {
		t.Fatal("uncertain recovery not idempotent", again, err)
	}
	if _, err = q.Recover(ctx, rpc, id, hash(940), "changed reason", 0); err == nil {
		t.Fatal("operation ID repurposed")
	}
	if _, err = pool.Exec(ctx, `DELETE FROM tickergarden.treasury_job_recoveries WHERE operation_id=$1`, hash(940)); err == nil {
		t.Fatal("recovery record deleted")
	}
	history, err = q.History(ctx, id, history[len(history)-1].Sequence)
	if err != nil || len(history) != 1 || history[0].Event != "reopened" || history[0].RecoveryCount != 1 {
		t.Fatal("recovery not atomically audited", history, err)
	}
	exhaust()
	if _, err = q.Recover(ctx, rpc, id, hash(941), "RPC repaired again", 0); err == nil {
		t.Fatal("stale recovery revision accepted")
	}
	if _, err = q.Recover(ctx, rpc, id, hash(941), "RPC repaired again", 1); err != nil {
		t.Fatal(err)
	}
	completed, err := treasury.ProcessJobOnce(ctx, q, pool, rpc, rpc.manifest)
	if err != nil || completed.ID != id || completed.State != "succeeded" || completed.RecoveryCount != 2 {
		t.Fatal("recovered worker failed", completed, err)
	}
	history, err = q.History(ctx, id, 0)
	if err != nil || len(history) != 25 || history[24].Event != "succeeded" {
		t.Fatal("prior attempt history lost", len(history), err)
	}

	t.Setenv("TG_TREASURY_JOBS_DATABASE_URL", pool.Config().ConnConfig.ConnString())
	var stdout, stderr bytes.Buffer
	if code := treasury.RunJobs(ctx, []string{"--history", id, "--after", "0"}, &stdout, &stderr); code != 0 {
		t.Fatal("history CLI failed", stderr.String())
	}
	var wire struct {
		Items     []treasury.JobAudit `json:"items"`
		NextAfter int64               `json:"nextAfter"`
	}
	if e := json.Unmarshal(stdout.Bytes(), &wire); e != nil || len(wire.Items) != 25 || wire.NextAfter != history[24].Sequence {
		t.Fatal("history CLI pagination mismatch", e)
	}
	if _, err = q.Recover(ctx, rpc, id, hash(942), "cannot retry success", 2); err == nil {
		t.Fatal("successful job recovered")
	}
	testTreasuryReview(t, ctx, pool, *completed.CandidateID, rpc)
}
