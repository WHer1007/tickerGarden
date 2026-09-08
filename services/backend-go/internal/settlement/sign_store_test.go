package settlement

import (
	"context"
	"encoding/hex"
	"os"
	"strings"
	"testing"
	"tickergarden/backend/internal/postgres"
	"time"
)

type noSigner struct{}

func (noSigner) Sign(context.Context, SignRequest) ([]byte, error) {
	panic("signer must not run on recovery")
}
func TestIsolatedSettlementSigning(t *testing.T) {
	dsn := os.Getenv("TG_SETTLEMENT_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated signing database not supplied")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var scope WorkScope
	var key string
	if pool.QueryRow(ctx, `SELECT chain_id,genesis_hash,sender,job_key FROM tickergarden.settlement_intents ORDER BY created_at LIMIT 1`).Scan(&scope.ChainID, &scope.GenesisHash, &scope.Operator, &key) != nil {
		t.Fatal("no intent")
	}
	s := Store{Pool: pool, ChainID: scope.ChainID}
	in, err := s.Intent(ctx, scope, key)
	if err != nil {
		t.Fatal(err)
	}
	original, err := s.Signed(ctx, scope, key)
	if err != nil || original.Transaction == nil {
		t.Fatal(original, err)
	}
	if _, err = s.Sign(ctx, noIntentRPC{}, noSigner{}, scope, key, in.Intent.Fees); err != nil {
		t.Fatal("stored retry", err)
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(original.Transaction.RawTransaction, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	// Model a process that signed but lost the response before saving bytes.
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.settlement_sign_requests SET raw_transaction=NULL,transaction_hash=NULL WHERE job_key=$1`, key); err != nil {
		t.Fatal(err)
	}
	unknown, err := s.Sign(ctx, noIntentRPC{}, noSigner{}, scope, key, in.Intent.Fees)
	if err != nil || unknown.Status != "signing_unknown" || unknown.Transaction != nil {
		t.Fatal(unknown, err)
	}
	if _, err = s.ImportSigned(ctx, scope, key, []byte{1, 2, 3}); err == nil {
		t.Fatal("bad recovery imported")
	}
	restored, err := s.ImportSigned(ctx, scope, key, raw)
	if err != nil || restored.Transaction == nil || restored.Transaction.TransactionHash != original.Transaction.TransactionHash {
		t.Fatal(restored, err)
	}
	if _, err = s.ImportSigned(ctx, scope, key, raw); err != nil {
		t.Fatal("idempotent import", err)
	}
	foreign := scope
	foreign.Operator = "0x00000000000000000000000000000000000000fe"
	if _, err = s.Signed(ctx, foreign, key); err == nil {
		t.Fatal("cross sender signed read")
	}
	var payload []byte
	if pool.QueryRow(ctx, `SELECT request_payload FROM tickergarden.settlement_sign_requests WHERE job_key=$1`, key).Scan(&payload) != nil {
		t.Fatal("missing request")
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.settlement_sign_requests SET request_payload=$2 WHERE job_key=$1`, key, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Signed(ctx, scope, key); err == nil {
		t.Fatal("corrupt authorization accepted")
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.settlement_sign_requests SET request_payload=$2 WHERE job_key=$1`, key, payload); err != nil {
		t.Fatal(err)
	}
}
