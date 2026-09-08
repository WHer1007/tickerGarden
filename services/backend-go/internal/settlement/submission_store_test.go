package settlement

import (
	"context"
	"os"
	"testing"
	"time"

	"tickergarden/backend/internal/postgres"
)

type submissionNoSendRPC struct{ noIntentRPC }

func (submissionNoSendRPC) SendRawTransaction(context.Context, []byte) (string, error) {
	panic("SendRawTransaction must not run for stored submission")
}

func TestIsolatedSettlementSubmission(t *testing.T) {
	dsn := os.Getenv("TG_SETTLEMENT_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated submission database not supplied")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	p, err := postgres.Open(ctx, dsn, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	var scope WorkScope
	var key, hash, status string
	if err = p.QueryRow(ctx, `SELECT i.chain_id,i.genesis_hash,i.sender,i.job_key,s.transaction_hash,s.status FROM tickergarden.settlement_intents i JOIN tickergarden.settlement_submissions s USING(job_key) ORDER BY i.created_at LIMIT 1`).Scan(&scope.ChainID, &scope.GenesisHash, &scope.Operator, &key, &hash, &status); err != nil {
		t.Fatal("missing submission fixture", err)
	}
	s := Store{Pool: p, ChainID: scope.ChainID}
	got, err := s.Submit(ctx, submissionNoSendRPC{}, scope, key, hash)
	if err != nil || got.Status != status {
		t.Fatal(got, err)
	}
	if _, err = s.Submit(ctx, submissionNoSendRPC{}, scope, key, hash); err != nil {
		t.Fatal(err)
	}
	var payload []byte
	if err = p.QueryRow(ctx, `SELECT authorization_payload FROM tickergarden.settlement_submissions WHERE job_key=$1`, key).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if _, err = p.Exec(ctx, `UPDATE tickergarden.settlement_submissions SET status='submission_unknown' WHERE job_key=$1`, key); err != nil {
		t.Fatal(err)
	}
	defer p.Exec(context.Background(), `UPDATE tickergarden.settlement_submissions SET status=$2,authorization_payload=$3 WHERE job_key=$1`, key, status, payload)
	if got, err = s.Submit(ctx, submissionNoSendRPC{}, scope, key, hash); err != nil || got.Status != "submission_unknown" {
		t.Fatal(got, err)
	}
	if _, err = s.Submit(ctx, submissionNoSendRPC{}, scope, key, "0xdead"); err == nil {
		t.Fatal("accepted wrong hash")
	}
	if _, err = p.Exec(ctx, `UPDATE tickergarden.settlement_submissions SET authorization_payload=$2 WHERE job_key=$1`, key, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Submission(ctx, scope, key); err == nil {
		t.Fatal("accepted corrupted authorization")
	}
	if _, err = p.Exec(ctx, `UPDATE tickergarden.settlement_submissions SET authorization_payload=$2 WHERE job_key=$1`, key, payload); err != nil {
		t.Fatal(err)
	}
	foreign := scope
	foreign.Operator = "0x00000000000000000000000000000000000000fe"
	if _, err = s.Submission(ctx, foreign, key); err == nil {
		t.Fatal("accepted foreign operator")
	}
}
