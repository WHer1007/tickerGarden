package maintenance

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"math/big"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"time"
)

func TestBudgetNumbers(t *testing.T) {
	for _, s := range []string{"", "-1", "01", "1.0", "1e9", strings.Repeat("9", 79), new(big.Int).Lsh(big.NewInt(1), 256).String()} {
		if _, ok := budgetNumber(s); ok {
			t.Fatal("invalid amount", s)
		}
	}
	for _, s := range []string{"0", "1", new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)).String()} {
		if _, ok := budgetNumber(s); !ok {
			t.Fatal("valid amount rejected", s)
		}
	}
}
func TestIsolatedMaintenanceGasBudget(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated maintenance database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 12)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	store := Store{Pool: pool, ChainID: 46630}
	history, e := store.History(ctx, os.Getenv("TG_MAINTENANCE_TEST_KEY"), 0)
	if e != nil || len(history) == 0 {
		t.Fatal(e)
	}
	private, e := crypto.HexToECDSA(fmt.Sprintf("%064x", 5000))
	if e != nil {
		t.Fatal(e)
	}
	sender := strings.ToLower(crypto.PubkeyToAddress(private.PublicKey).Hex())
	type prepared struct {
		p    deployment.MaintenancePreview
		l    Lease
		hash string
		rpc  submissionFixture
	}
	jobs := []prepared{}
	var sends atomic.Int64
	for i := range 8 {
		p := noncePreview(history[0].Preview, 1500+i)
		p.From = sender
		p.Key = deployment.Hash([]byte(strings.Join([]string{"V1-EXEC-11:maintenance-v1", "46630", p.GenesisHash, p.From, p.Module, p.To, p.Request.Operation, p.Request.MarketID, p.Request.User, p.Request.TriggerID}, ":")))
		f := submissionFixture{intentFixture: intentFixture{nonceFixture: nonceFixture{p: p}}, store: store, key: p.Key, mode: "lost", sends: &sends}
		fees := Fees{"50000", "100", "2"}
		var simulations atomic.Int64
		f.calls = &simulations
		f.want, _, e = intentCall(p, Reservation{Nonce: strconv.Itoa(i)}, fees)
		if e != nil {
			t.Fatal(e)
		}
		pre, e := store.Prepare(ctx, f, p, fees, "budget-test", fmt.Sprintf("0x%064x", 16000+i), 300)
		if e != nil {
			t.Fatal(e)
		}
		nonce, e := strconv.ParseUint(pre.Record.Intent.Reservation.Nonce, 10, 64)
		if e != nil {
			t.Fatal(e)
		}
		to := common.HexToAddress(p.To)
		data, _ := hex.DecodeString(p.Data[2:])
		tx, e := types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: big.NewInt(46630), Nonce: nonce, Gas: 50000, GasFeeCap: big.NewInt(100), GasTipCap: big.NewInt(2), To: &to, Value: big.NewInt(0), Data: data}), types.NewLondonSigner(big.NewInt(46630)), private)
		if e != nil {
			t.Fatal(e)
		}
		raw, e := tx.MarshalBinary()
		if e != nil {
			t.Fatal(e)
		}
		signed, e := store.AttachSigned(ctx, p.Key, pre.Record.Digest, pre.Lease.Owner, pre.Lease.Token, pre.Lease.Generation, raw)
		if e != nil {
			t.Fatal(e)
		}
		jobs = append(jobs, prepared{p, pre.Lease, signed.TransactionHash, f})
	}
	submit := func(j prepared) (Submission, error) {
		return store.Submit(ctx, j.rpc, j.p, j.hash, j.l.Owner, j.l.Token, j.l.Generation)
	}
	first := jobs[0]
	if _, e = submit(first); !errors.Is(e, ErrBudgetRequired) || sends.Load() != 0 {
		t.Fatal("missing budget sent", e, sends.Load())
	}
	genesis := first.p.GenesisHash
	id := func(n int) string { return fmt.Sprintf("0x%064x", 17000+n) }
	if _, e = store.SetGasBudget(ctx, genesis, sender, "4999999", "5000000", id(0)); e != nil {
		t.Fatal(e)
	}
	if _, e = submit(first); !errors.Is(e, ErrBudgetExceeded) || sends.Load() != 0 {
		t.Fatal("per transaction limit", e)
	}
	initial, e := store.SetGasBudget(ctx, genesis, sender, "5000000", "5000000", id(1))
	if e != nil {
		t.Fatal(e)
	}
	var accepted atomic.Int64
	var wg sync.WaitGroup
	for _, j := range jobs {
		wg.Add(1)
		go func(j prepared) {
			defer wg.Done()
			r, e := submit(j)
			if errors.Is(e, chainrpc.ErrSubmissionUnknown) && r.Status == "submission_unknown" {
				accepted.Add(1)
			} else if !errors.Is(e, ErrBudgetExceeded) {
				t.Error(r, e)
			}
		}(j)
	}
	wg.Wait()
	if sends.Load() != 1 || accepted.Load() != 1 {
		t.Fatal("concurrent overspend", sends.Load(), accepted.Load())
	}
	b, e := store.GasBudget(ctx, genesis, sender)
	if e != nil || b.Allocated != "5000000" {
		t.Fatal(b, e)
	}
	var charges, submissions int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_gas_budget_charges WHERE sender=$1`, sender).Scan(&charges); e != nil || charges != 1 {
		t.Fatal(charges, e)
	}
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_submissions s JOIN tickergarden.maintenance_jobs j USING(job_key) WHERE convert_from(j.identity_payload,'UTF8')::jsonb->>'from'=$1`, sender).Scan(&submissions); e != nil || submissions != 1 {
		t.Fatal("denial left outbox", submissions, e)
	}
	retry, e := store.SetGasBudget(ctx, genesis, sender, "5000000", "5000000", id(1))
	if e != nil || retry != initial {
		t.Fatal("config retry changed", retry, e)
	}
	if _, e = store.SetGasBudget(ctx, genesis, sender, "5000000", "10000000", id(1)); e == nil {
		t.Fatal("request ID reused with different limits")
	}
	if _, e = store.SetGasBudget(ctx, genesis, sender, "1", "4999999", id(2)); !errors.Is(e, ErrBudgetExceeded) {
		t.Fatal("lowered below allocation", e)
	}
	var blocked prepared
	for _, j := range jobs {
		_, e := store.Submission(ctx, j.p.Key)
		if e != nil {
			blocked = j
			continue
		}
		r, e := submit(j)
		if e != nil || r.Status != "submission_unknown" || sends.Load() != 1 {
			t.Fatal("retry sent or recharged", r, e)
		}
	}
	increased, e := store.SetGasBudget(ctx, genesis, sender, "5000000", "10000000", id(3))
	if e != nil || increased.Allocated != "5000000" {
		t.Fatal(increased, e)
	}
	if _, e = submit(blocked); !errors.Is(e, chainrpc.ErrSubmissionUnknown) || sends.Load() != 2 {
		t.Fatal("budget increase did not admit", e)
	}
	b, e = store.GasBudget(ctx, genesis, sender)
	if e != nil || b.Allocated != "10000000" {
		t.Fatal(b, e)
	}
	var actor string
	if e = pool.QueryRow(ctx, `SELECT changed_by FROM tickergarden.maintenance_gas_budget_changes WHERE sender=$1 AND request_id=$2`, sender, id(3)).Scan(&actor); e != nil || actor == "" {
		t.Fatal("missing audit actor", e)
	}
}
