package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/treasury"
)

func testTreasuryJobs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, c treasury.Candidate, candidateID string) {
	t.Helper()
	m := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: c.Journal.ChainID, GenesisHash: hash(789)}
	for i, module := range []string{"TickerGardenFactoryV1", "OfficialStockRegistryV1", "ApprovedQuoteRegistry", "TickerGardenBaselineRegistry", "LaunchTemplateRegistry", "MarketRegistryV1", "ProtocolFeeVault", "AllocationManager", "LaunchAndBuyRouter", "TreasuryDistributorV1"} {
		address := fmt.Sprintf("0x%040x", 800+i)
		if module == "TreasuryDistributorV1" {
			address = c.Input.Distributor
		}
		m.Contracts = append(m.Contracts, deployment.Contract{Module: module, Address: address, RuntimeCodeHash: hash(800)})
	}
	in := c.Input
	in.Transfers = []treasury.Transfer{}
	spec := treasury.JobSpec{Input: in, Manifest: m}
	q := treasury.JobQueue{Pool: pool}
	id, err := q.Enqueue(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := q.Enqueue(ctx, spec)
	if err != nil || duplicate != id {
		t.Fatal("enqueue not idempotent", err)
	}
	other := m
	other.Contracts = append([]deployment.Contract{}, m.Contracts...)
	other.Contracts[0].RuntimeCodeHash = hash(801)
	if _, err = q.Claim(ctx, other); !errors.Is(err, treasury.ErrNoJob) {
		t.Fatal("worker crossed manifest scope", err)
	}
	// Competing workers acquire exactly one lease.
	var wg sync.WaitGroup
	results := make(chan treasury.Job, 8)
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			j, e := q.Claim(ctx, m)
			if e == nil {
				results <- j
			} else if !errors.Is(e, treasury.ErrNoJob) {
				failures <- e
			}
		}()
	}
	wg.Wait()
	close(results)
	close(failures)
	for e := range failures {
		t.Fatal(e)
	}
	var first treasury.Job
	count := 0
	for j := range results {
		first = j
		count++
	}
	if count != 1 || first.Attempts != 1 {
		t.Fatal("duplicate lease", count, first)
	}
	if _, err = q.Enqueue(ctx, spec); err != nil {
		t.Fatal(err)
	}
	status, err := q.Status(ctx, id)
	if err != nil || status.State != "running" || status.Attempts != 1 {
		t.Fatal("duplicate enqueue reset job", status, err)
	}
	// Simulate process death by advancing database lease expiry, no wall-clock sleep.
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET lease_until=now()-interval '1 second' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	second, err := q.Claim(ctx, m)
	if err != nil || second.Attempts != 2 || second.Token == first.Token {
		t.Fatal("lease not recovered", second, err)
	}
	if err = q.Fail(ctx, first); !errors.Is(err, treasury.ErrLeaseLost) {
		t.Fatal("stale owner rescheduled", err)
	}
	if err = q.Complete(ctx, first, candidateID); !errors.Is(err, treasury.ErrLeaseLost) {
		t.Fatal("stale owner completed", err)
	}
	if err = q.Complete(ctx, second, candidateID); err != nil {
		t.Fatal("candidate completion failed", err)
	}
	status, err = q.Status(ctx, id)
	if err != nil || status.State != "succeeded" || status.CandidateID == nil || *status.CandidateID != candidateID {
		t.Fatal(status, err)
	}
	encoded, _ := json.Marshal(status)
	var fields map[string]any
	json.Unmarshal(encoded, &fields)
	if fields["Token"] != nil || fields["Spec"] != nil {
		t.Fatal("status leaked internals")
	}
	if err = q.Complete(ctx, second, candidateID); !errors.Is(err, treasury.ErrLeaseLost) {
		t.Fatal("completed lease reused", err)
	}

	// Exercise the CLI entry with its own database pool and frozen input files.
	t.Setenv("TG_TREASURY_JOBS_DATABASE_URL", pool.Config().ConnConfig.ConnString())
	dir := t.TempDir()
	inputFile := filepath.Join(dir, "request.json")
	manifestFile := filepath.Join(dir, "deployment.json")
	inputBytes, _ := json.Marshal(in)
	manifestBytes, _ := json.Marshal(m)
	if e := os.WriteFile(inputFile, inputBytes, 0600); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(manifestFile, manifestBytes, 0600); e != nil {
		t.Fatal(e)
	}
	for _, args := range [][]string{{"--enqueue", inputFile, "--manifest", manifestFile}, {"--status", id}} {
		var stdout, stderr bytes.Buffer
		if code := treasury.RunJobs(ctx, args, &stdout, &stderr); code != 0 {
			t.Fatal("job CLI failed", args, stderr.String())
		}
		var result map[string]any
		if e := json.Unmarshal(stdout.Bytes(), &result); e != nil {
			t.Fatal(e)
		}
		if args[0] == "--enqueue" && result["jobId"] != id {
			t.Fatal("CLI changed job identity", result)
		}
		if args[0] == "--status" && (result["state"] != "succeeded" || result["candidateId"] != candidateID) {
			t.Fatal("CLI status mismatch", result)
		}
	}
	// New distinct input creates a new immutable job. Existing candidate must not attach.
	spec.Input.QuoteAmount = "1001"
	retryID, err := q.Enqueue(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := q.Claim(ctx, m)
	if err != nil {
		t.Fatal(err)
	}
	if err = q.Complete(ctx, retry, candidateID); err == nil {
		t.Fatal("wrong candidate attached")
	}
	if err = q.Fail(ctx, retry); err != nil {
		t.Fatal(err)
	}
	if _, err = q.Claim(ctx, m); !errors.Is(err, treasury.ErrNoJob) {
		t.Fatal("retry ignored backoff", err)
	}
	for attempt := 2; attempt <= 5; attempt++ {
		if _, err = pool.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET available_at=now()-interval '1 second' WHERE id=$1`, retryID); err != nil {
			t.Fatal(err)
		}
		retry, err = q.Claim(ctx, m)
		if err != nil || retry.Attempts != attempt {
			t.Fatal("retry accounting", retry, err)
		}
		if err = q.Fail(ctx, retry); err != nil {
			t.Fatal(err)
		}
	}
	status, err = q.Status(ctx, retryID)
	if err != nil || status.State != "dead" || status.Attempts != 5 {
		t.Fatal("not dead after retry budget", status, err)
	}
	if _, err = q.Enqueue(ctx, spec); err != nil {
		t.Fatal(err)
	}
	if _, err = q.Claim(ctx, m); !errors.Is(err, treasury.ErrNoJob) {
		t.Fatal("dead job revived on duplicate enqueue", err)
	}
	// A crash on the last allowed attempt also becomes terminal.
	spec.Input.QuoteAmount = "1002"
	crashID, err := q.Enqueue(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	crash, err := q.Claim(ctx, m)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET attempts=5,lease_until=now()-interval '1 second' WHERE id=$1`, crash.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = q.Claim(ctx, m); !errors.Is(err, treasury.ErrNoJob) {
		t.Fatal(err)
	}
	status, err = q.Status(ctx, crashID)
	if err != nil || status.State != "dead" || status.ErrorCode != "lease_exhausted" {
		t.Fatal(status, err)
	}
	// Corrupted immutable job body is quarantined before processing.
	spec.Input.QuoteAmount = "1003"
	badID, err := q.Enqueue(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET payload=payload || decode('20','hex') WHERE id=$1`, badID); err != nil {
		t.Fatal(err)
	}
	if _, err = q.Enqueue(ctx, spec); err == nil {
		t.Fatal("enqueue concealed corruption")
	}
	if _, err = q.Claim(ctx, m); err == nil || errors.Is(err, treasury.ErrNoJob) {
		t.Fatal("corrupt body accepted", err)
	}
	status, err = q.Status(ctx, badID)
	if err != nil || status.State != "dead" || status.ErrorCode != "invalid_payload" {
		t.Fatal(status, err)
	}
	// RPC failure through the actual processor must persist retry, no candidate.
	spec.Input.QuoteAmount = "1004"
	failureID, err := q.Enqueue(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = treasury.ProcessJobOnce(ctx, q, pool, jobFailRPC{}, m); err == nil {
		t.Fatal("RPC failure succeeded")
	}
	status, err = q.Status(ctx, failureID)
	if err != nil || status.State != "ready" || status.ErrorCode != "processing_failed" || status.CandidateID != nil {
		t.Fatal(status, err)
	}
}

type jobFailRPC struct{}

func (jobFailRPC) ChainID(context.Context) (uint64, error) { return 0, errors.New("fixture failure") }
func (jobFailRPC) Header(context.Context, string) (chainrpc.Header, error) {
	return chainrpc.Header{}, errors.New("secret RPC response")
}
func (jobFailRPC) CodeAt(context.Context, string, string) ([]byte, error) {
	return nil, errors.New("fixture failure")
}
func (jobFailRPC) CallAt(context.Context, string, string, string) ([]byte, error) {
	return nil, errors.New("fixture failure")
}
