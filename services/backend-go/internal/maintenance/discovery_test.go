package maintenance

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
)

func TestIsolatedMaintenanceDiscoveryScope(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_TEST_DSN")
	scope := os.Getenv("TG_MAINTENANCE_TEST_SCOPE")
	if dsn == "" || scope == "" {
		t.Skip("isolated discovered scope required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 4)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	store := Store{Pool: pool, ChainID: 46630}
	var body []byte
	var job string
	var generation int64
	if e = pool.QueryRow(ctx, `SELECT scope_payload,active_job_key,generation FROM tickergarden.maintenance_work_scopes WHERE scope_key=$1`, scope).Scan(&body, &job, &generation); e != nil {
		t.Fatal(e)
	}
	if deployment.Hash(body) != scope || generation != 1 {
		t.Fatal("invalid scope identity")
	}
	history, e := store.History(ctx, job, 0)
	if e != nil || len(history) != 1 {
		t.Fatal(history, e)
	}
	p := history[0].Preview
	raw, e := os.ReadFile(os.Getenv("TG_MAINTENANCE_TEST_MANIFEST"))
	if e != nil {
		t.Fatal(e)
	}
	manifest, e := deployment.Parse(raw)
	if e != nil {
		t.Fatal(e)
	}
	rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if e != nil {
		t.Fatal(e)
	}
	request := p.Request
	request.TriggerID = ""
	defer pool.Exec(context.Background(), `UPDATE tickergarden.maintenance_work_scopes SET scope_payload=$2,active_job_key=$3 WHERE scope_key=$1`, scope, body, job)
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_work_scopes SET scope_payload=$2 WHERE scope_key=$1`, scope, []byte("{}")); e != nil {
		t.Fatal(e)
	}
	if _, e = store.DiscoverWork(ctx, rpc, manifest, p.From, request); e == nil {
		t.Fatal("corrupt scope accepted")
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_work_scopes SET scope_payload=$2,active_job_key=$3 WHERE scope_key=$1`, scope, body, os.Getenv("TG_MAINTENANCE_TEST_KEY")); e != nil {
		t.Fatal(e)
	}
	if _, e = store.DiscoverWork(ctx, rpc, manifest, p.From, request); e == nil {
		t.Fatal("scope attached to another operation")
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_work_scopes SET active_job_key=$2 WHERE scope_key=$1`, scope, job); e != nil {
		t.Fatal(e)
	}
	retry, e := store.DiscoverWork(ctx, rpc, manifest, p.From, request)
	if e != nil || retry.Status != "awaiting_existing" || retry.JobKey != job || retry.Generation != 1 {
		t.Fatal(retry, e)
	}
	var recordCount int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_simulations WHERE job_key=$1`, job).Scan(&recordCount); e != nil || recordCount != 1 {
		t.Fatal("duplicate simulation", e)
	}
	if _, e = store.DiscoverWork(ctx, rpc, manifest, "0x0", request); e == nil {
		t.Fatal("invalid sender accepted")
	}
	request.TriggerID = p.Request.TriggerID
	if _, e = store.DiscoverWork(ctx, rpc, manifest, p.From, request); e == nil {
		t.Fatal("caller trigger accepted")
	}
	var obj map[string]any
	if json.Unmarshal(body, &obj) != nil {
		t.Fatal("scope JSON invalid")
	}
}
