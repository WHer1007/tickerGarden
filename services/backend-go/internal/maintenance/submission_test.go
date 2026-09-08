package maintenance

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
)

type submissionFixture struct {
	intentFixture
	store  Store
	key    string
	mode   string
	sends  *atomic.Int64
	cancel context.CancelFunc
}

func (f submissionFixture) SendRawTransaction(ctx context.Context, raw []byte) (string, error) {
	f.sends.Add(1)
	hash := deployment.Hash(raw)
	// A separate transaction must already see the recovery record before bytes
	// leave the process; this also proves the job lock was released.
	record, e := f.store.Submission(ctx, f.key)
	if e != nil || record.Status != "submission_unknown" || record.TransactionHash != hash {
		return "", errors.New("submission not durable before send")
	}
	switch f.mode {
	case "lost":
		return hash, chainrpc.ErrSubmissionUnknown
	case "wrong":
		return "0x" + strings.Repeat("a", 64), nil
	case "cancel":
		f.cancel()
	}
	return hash, nil
}

func TestIsolatedMaintenanceSubmissions(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 10)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	store := Store{Pool: pool, ChainID: 46630}
	history, e := store.History(ctx, os.Getenv("TG_MAINTENANCE_TEST_KEY"), 0)
	if e != nil || len(history) == 0 {
		t.Fatal(e)
	}
	for i, mode := range []string{"ack", "lost", "wrong", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			p := noncePreview(history[0].Preview, 300+i)
			key, e := crypto.HexToECDSA(fmt.Sprintf("%064x", 100+i))
			if e != nil {
				t.Fatal(e)
			}
			p.From = strings.ToLower(crypto.PubkeyToAddress(key.PublicKey).Hex())
			p.Key = deployment.Hash([]byte(strings.Join([]string{"V1-EXEC-11:maintenance-v1", "46630", p.GenesisHash, p.From, p.Module, p.To, p.Request.Operation, p.Request.MarketID, p.Request.User, p.Request.TriggerID}, ":")))
			if _, e = store.SetGasBudget(ctx, p.GenesisHash, p.From, "5000000", "5000000", fmt.Sprintf("0x%064x", 12000+i)); e != nil {
				t.Fatal(e)
			}
			if _, e = store.Record(ctx, p); e != nil {
				t.Fatal(e)
			}
			lease, e := store.AcquireLease(ctx, p.Key, "submit-worker", fmt.Sprintf("0x%064x", 9000+i), 60)
			if e != nil {
				t.Fatal(e)
			}
			reservation, e := store.ReserveNonce(ctx, nonceFixture{p: p}, p, lease.Owner, lease.Token, lease.Generation)
			if e != nil {
				t.Fatal(e)
			}
			fees := Fees{"50000", "100", "2"}
			call, _, e := intentCall(p, reservation, fees)
			if e != nil {
				t.Fatal(e)
			}
			var simulations, sends atomic.Int64
			f := submissionFixture{intentFixture: intentFixture{nonceFixture: nonceFixture{p: p}, calls: &simulations, want: call}, store: store, key: p.Key, mode: mode, sends: &sends}
			intent, e := store.PrepareIntent(ctx, f, p, fees, lease.Owner, lease.Token, lease.Generation)
			if e != nil {
				t.Fatal(e)
			}
			nonce, _ := strconv.ParseUint(reservation.Nonce, 10, 64)
			data, _ := hex.DecodeString(p.Data[2:])
			to := common.HexToAddress(p.To)
			signed, e := types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: big.NewInt(46630), Nonce: nonce, Gas: 50000, GasFeeCap: big.NewInt(100), GasTipCap: big.NewInt(2), To: &to, Value: big.NewInt(0), Data: data}), types.NewLondonSigner(big.NewInt(46630)), key)
			if e != nil {
				t.Fatal(e)
			}
			raw, e := signed.MarshalBinary()
			if e != nil {
				t.Fatal(e)
			}
			saved, e := store.AttachSigned(ctx, p.Key, intent.Digest, lease.Owner, lease.Token, lease.Generation, raw)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = store.Submit(ctx, f, p, "0x"+strings.Repeat("f", 64), lease.Owner, lease.Token, lease.Generation); e == nil {
				t.Fatal("wrong hash accepted")
			}
			if _, e = store.Submit(ctx, f, p, saved.TransactionHash, lease.Owner, lease.Token, lease.Generation+1); e == nil {
				t.Fatal("wrong fence accepted")
			}
			invalid := f
			invalid.bad = true
			if _, e = store.Submit(ctx, invalid, p, saved.TransactionHash, lease.Owner, lease.Token, lease.Generation); e == nil {
				t.Fatal("revert accepted")
			}
			if _, e = store.Submission(ctx, p.Key); e == nil || sends.Load() != 0 {
				t.Fatal("preflight failure created submission")
			}
			runctx, runCancel := context.WithCancel(ctx)
			defer runCancel()
			f.cancel = runCancel
			if mode == "ack" {
				var wg sync.WaitGroup
				for range 8 {
					wg.Go(func() {
						r, e := store.Submit(runctx, f, p, saved.TransactionHash, lease.Owner, lease.Token, lease.Generation)
						if e != nil || r.TransactionHash != saved.TransactionHash {
							t.Errorf("concurrent submit: %#v %v", r, e)
						}
					})
				}
				wg.Wait()
			} else {
				r, e := store.Submit(runctx, f, p, saved.TransactionHash, lease.Owner, lease.Token, lease.Generation)
				if !errors.Is(e, chainrpc.ErrSubmissionUnknown) || r.Status != "submission_unknown" {
					t.Fatalf("unknown: %#v %v", r, e)
				}
			}
			if sends.Load() != 1 {
				t.Fatalf("send count %d", sends.Load())
			}
			out, e := store.Submission(ctx, p.Key)
			if e != nil {
				t.Fatal(e)
			}
			want := "submission_unknown"
			if mode == "ack" {
				want = "acknowledged"
			}
			if out.Status != want {
				t.Fatalf("status=%s", out.Status)
			}
			if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE job_key=$1`, p.Key); e != nil {
				t.Fatal(e)
			}
			if mode == "lost" {
				exerciseRebroadcast(t, ctx, store, p, saved, f)
			}
			if mode == "ack" {
				exerciseReceiptRecovery(t, ctx, store, p, saved)
				exerciseGasCosts(t, ctx, store, p.Key)
				exerciseGasReconciliation(t, ctx, store, p, saved)
			}
			retry, e := store.Submit(ctx, f, p, saved.TransactionHash, lease.Owner, lease.Token, lease.Generation)
			if e != nil || retry != out || sends.Load() != 1 {
				t.Fatalf("retry changed submission: %#v %v", retry, e)
			}
			if _, e = store.AcquireLease(ctx, p.Key, "other", fmt.Sprintf("0x%064x", 10000+i), 60); !errors.Is(e, ErrNonceReserved) {
				t.Fatalf("reserved job reacquired: %v", e)
			}
			if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_submissions SET intent_digest=$2 WHERE job_key=$1`, p.Key, "0x"+strings.Repeat("f", 64)); e != nil {
				t.Fatal(e)
			}
			if _, e = store.Submission(ctx, p.Key); e == nil {
				t.Fatal("corrupt submission accepted")
			}
			if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_submissions SET intent_digest=$2 WHERE job_key=$1`, p.Key, intent.Digest); e != nil {
				t.Fatal(e)
			}
		})
	}
	exerciseReconciliationQueue(t, ctx, store)
}
