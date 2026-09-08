package maintenance

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type recoveryFixture struct {
	submissionFixture
	attempt    string
	consumed   bool
	hasReceipt bool
}

func (f recoveryFixture) NonceAtHash(_ context.Context, from, hash string) (uint64, error) {
	if from != f.p.From || hash != f.p.BlockHash {
		return 0, ErrUnavailable
	}
	if f.consumed {
		return 999, nil
	}
	return 0, nil
}
func (f recoveryFixture) TransactionReceipt(context.Context, string) (*chainrpc.Receipt, error) {
	if f.hasReceipt {
		return &chainrpc.Receipt{}, nil
	}
	return nil, nil
}
func (f recoveryFixture) SendRawTransaction(ctx context.Context, raw []byte) (string, error) {
	f.sends.Add(1)
	hash := deployment.Hash(raw)
	out, e := f.store.RebroadcastAttempt(ctx, f.key, f.attempt)
	if e != nil || out.TransactionHash != hash || out.Status != "submission_unknown" {
		return "", errors.New("attempt not durable before send")
	}
	if f.mode == "lost" {
		return hash, chainrpc.ErrSubmissionUnknown
	}
	return hash, nil
}
func exerciseRebroadcast(t *testing.T, ctx context.Context, store Store, p deployment.MaintenancePreview, signed SignedTransaction, base submissionFixture) {
	t.Helper()
	var sends atomic.Int64
	f := recoveryFixture{submissionFixture: base, attempt: fmt.Sprintf("0x%064x", 12000)}
	f.store = store
	f.key = p.Key
	f.sends = &sends
	f.mode = "ack"
	// A large pending nonce must not reject rebroadcast of the same bytes: only
	// confirmed nonce on the pinned canonical block consumes the reservation.
	f.pending = 999
	for _, kind := range []string{"consumed", "receipt", "simulation", "wrong-chain"} {
		bad := f
		switch kind {
		case "consumed":
			bad.consumed = true
		case "receipt":
			bad.hasReceipt = true
		case "simulation":
			bad.bad = true
		case "wrong-chain":
			bad.wrongChain = true
		}
		if _, e := store.Rebroadcast(ctx, bad, p, signed.TransactionHash, f.attempt); e == nil {
			t.Fatalf("accepted %s", kind)
		}
	}
	if _, e := store.RebroadcastAttempt(ctx, p.Key, f.attempt); e == nil || sends.Load() != 0 {
		t.Fatal("failed recovery persisted or sent")
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			out, e := store.Rebroadcast(ctx, f, p, signed.TransactionHash, f.attempt)
			if e != nil || out.TransactionHash != signed.TransactionHash {
				t.Errorf("recovery %#v %v", out, e)
			}
		})
	}
	wg.Wait()
	if sends.Load() != 1 {
		t.Fatalf("sent %d times", sends.Load())
	}
	saved, e := store.RebroadcastAttempt(ctx, p.Key, f.attempt)
	if e != nil || saved.Status != "acknowledged" {
		t.Fatal(saved, e)
	}
	// Existing request ID is read-only even if conditions changed after sending.
	f.consumed = true
	f.hasReceipt = true
	same, e := store.Rebroadcast(ctx, f, p, signed.TransactionHash, f.attempt)
	if e != nil || same != saved || sends.Load() != 1 {
		t.Fatal("retry changed recovery", e)
	}
	f.consumed = false
	f.hasReceipt = false
	f.mode = "lost"
	f.attempt = fmt.Sprintf("0x%064x", 12001)
	lost, e := store.Rebroadcast(ctx, f, p, signed.TransactionHash, f.attempt)
	if !errors.Is(e, chainrpc.ErrSubmissionUnknown) || lost.Status != "submission_unknown" {
		t.Fatal(lost, e)
	}
	same, e = store.Rebroadcast(ctx, f, p, signed.TransactionHash, f.attempt)
	if e != nil || same != lost || sends.Load() != 2 {
		t.Fatal("unknown attempt resent", e)
	}
	if _, e = store.Rebroadcast(ctx, f, p, "0x"+strings.Repeat("e", 64), f.attempt); e == nil {
		t.Fatal("changed transaction accepted")
	}
	if _, e = store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_rebroadcasts SET transaction_hash=$3 WHERE job_key=$1 AND attempt_id=$2`, p.Key, f.attempt, "0x"+strings.Repeat("e", 64)); e != nil {
		t.Fatal(e)
	}
	if _, e = store.RebroadcastAttempt(ctx, p.Key, f.attempt); e == nil {
		t.Fatal("corrupt recovery accepted")
	}
	if _, e = store.Pool.Exec(ctx, `UPDATE tickergarden.maintenance_rebroadcasts SET transaction_hash=$3 WHERE job_key=$1 AND attempt_id=$2`, p.Key, f.attempt, signed.TransactionHash); e != nil {
		t.Fatal(e)
	}
}
