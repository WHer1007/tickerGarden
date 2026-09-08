package settlement

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/txaccount"
	"time"
)

type noIntentRPC struct{ IntentRPC }

func TestIsolatedSettlementIntent(t *testing.T) {
	dsn := os.Getenv("TG_SETTLEMENT_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated settlement database not supplied")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var raw []byte
	var nonce, next uint64
	if pool.QueryRow(ctx, `SELECT payload,nonce FROM tickergarden.settlement_intents ORDER BY created_at LIMIT 1`).Scan(&raw, &nonce) != nil {
		t.Fatal("missing intent")
	}
	var intent TransactionIntent
	if json.Unmarshal(raw, &intent) != nil {
		t.Fatal("invalid intent")
	}
	scope := WorkScope{ChainID: intent.ChainID, GenesisHash: intent.GenesisHash, Operator: intent.Call.From}
	store := Store{Pool: pool, ChainID: scope.ChainID}
	r, err := store.Intent(ctx, scope, intent.JobKey)
	if err != nil || r.Intent.Call != intent.Call {
		t.Fatal(r, err)
	}
	reused, wasReused, err := store.PrepareIntent(ctx, noIntentRPC{}, scope, intent.JobKey, intent.Fees)
	if err != nil || !wasReused || reused.Digest != r.Digest {
		t.Fatal("retry must use exact saved intent without RPC", reused, err)
	}
	if err = pool.QueryRow(ctx, `SELECT next_nonce FROM tickergarden.settlement_nonce_accounts WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3`, scope.ChainID, scope.GenesisHash, scope.Operator).Scan(&next); err != nil || next != nonce+1 {
		t.Fatal("nonce leaked across failed prepare/retry", next, err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = txaccount.Claim(ctx, tx, scope.ChainID, scope.GenesisHash, scope.Operator, "maintenance"); err == nil {
		t.Fatal("settlement account reused for maintenance")
	}
	tx.Rollback(ctx)
	other := "0x00000000000000000000000000000000000000f1"
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = txaccount.Claim(ctx, tx, scope.ChainID, scope.GenesisHash, other, "maintenance"); err != nil {
		t.Fatal(err)
	}
	if tx.Commit(ctx) != nil {
		t.Fatal("role commit")
	}
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = txaccount.Claim(ctx, tx, scope.ChainID, scope.GenesisHash, other, "settlement"); err == nil {
		t.Fatal("maintenance account reused for settlement")
	}
	tx.Rollback(ctx)
	foreign := scope
	foreign.Operator = other
	if _, err = store.Intent(ctx, foreign, intent.JobKey); err == nil {
		t.Fatal("cross sender intent read")
	}
	changed := intent.Fees
	changed.MaxPriorityFeePerGas = "0"
	if _, _, err = store.PrepareIntent(ctx, noIntentRPC{}, scope, intent.JobKey, changed); err == nil {
		t.Fatal("changed fees accepted")
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.settlement_intents SET payload=$1 WHERE job_key=$2`, []byte(`{}`), intent.JobKey); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Intent(ctx, scope, intent.JobKey); err == nil {
		t.Fatal("corrupt intent accepted")
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.settlement_intents SET payload=$1 WHERE job_key=$2`, raw, intent.JobKey); err != nil {
		t.Fatal(err)
	}
}
