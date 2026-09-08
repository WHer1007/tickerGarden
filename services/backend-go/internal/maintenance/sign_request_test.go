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
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"time"
)

type testSigner func(context.Context, IntentRecord) ([]byte, error)

func (f testSigner) Sign(c context.Context, i IntentRecord) ([]byte, error) { return f(c, i) }
func TestIsolatedMaintenanceSigning(t *testing.T) {
	dsn := os.Getenv("TG_MAINTENANCE_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated database required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 8)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	s := Store{Pool: pool, ChainID: 46630}
	h, e := s.History(ctx, os.Getenv("TG_MAINTENANCE_TEST_KEY"), 0)
	if e != nil || len(h) == 0 {
		t.Fatal(e)
	}
	for i, mode := range []string{"success", "unknown", "expired"} {
		t.Run(mode, func(t *testing.T) {
			p := noncePreview(h[0].Preview, 2000+i)
			key, e := crypto.HexToECDSA(fmt.Sprintf("%064x", 2000+i))
			if e != nil {
				t.Fatal(e)
			}
			p.From = strings.ToLower(crypto.PubkeyToAddress(key.PublicKey).Hex())
			p.Key = deployment.Hash([]byte(strings.Join([]string{"V1-EXEC-11:maintenance-v1", "46630", p.GenesisHash, p.From, p.Module, p.To, p.Request.Operation, p.Request.MarketID, p.Request.User, p.Request.TriggerID}, ":")))
			call, _, e := intentCall(p, Reservation{Nonce: "0"}, Fees{"50000", "100", "2"})
			if e != nil {
				t.Fatal(e)
			}
			var simulations, calls atomic.Int64
			f := intentFixture{nonceFixture: nonceFixture{p: p}, calls: &simulations, want: call}
			token := fmt.Sprintf("0x%064x", 12000+i)
			prepared, e := s.Prepare(ctx, f, p, Fees{"50000", "100", "2"}, "sign-test", token, 60)
			if e != nil {
				t.Fatal(e)
			}
			to := common.HexToAddress(p.To)
			data, _ := hex.DecodeString(p.Data[2:])
			tx, e := types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: big.NewInt(46630), Nonce: 0, Gas: 50000, GasFeeCap: big.NewInt(100), GasTipCap: big.NewInt(2), To: &to, Value: big.NewInt(0), Data: data}), types.NewLondonSigner(big.NewInt(46630)), key)
			if e != nil {
				t.Fatal(e)
			}
			raw, e := tx.MarshalBinary()
			if e != nil {
				t.Fatal(e)
			}
			signer := testSigner(func(ctx context.Context, in IntentRecord) ([]byte, error) {
				calls.Add(1)
				var visible bool
				if e := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.maintenance_sign_requests WHERE job_key=$1 AND raw_transaction IS NULL)`, p.Key).Scan(&visible); e != nil || !visible {
					t.Error("sign request not committed before invocation", e)
				}
				if mode == "unknown" {
					return nil, errors.New("private provider error")
				}
				if mode == "expired" {
					if _, e := pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE job_key=$1`, p.Key); e != nil {
						t.Error(e)
					}
				}
				return raw, nil
			})
			if _, e = s.ImportSignature(ctx, p.Key, prepared.Record.Digest, deployment.Hash(raw), "sign-test", token, 1, raw); e == nil {
				t.Fatal("import without signing request accepted")
			}
			if _, e = s.Sign(ctx, signer, p.Key, prepared.Record.Digest, "sign-test", token, 2); e == nil || calls.Load() != 0 {
				t.Fatal("bad fence invoked signer", e)
			}
			var wg sync.WaitGroup
			for range 8 {
				wg.Go(func() {
					r, e := s.Sign(ctx, signer, p.Key, prepared.Record.Digest, "sign-test", token, 1)
					if e != nil || r.JobKey != p.Key {
						t.Error(r, e)
					}
				})
			}
			wg.Wait()
			if calls.Load() != 1 {
				t.Fatal("duplicate signing", calls.Load())
			}
			r, e := s.Sign(ctx, signer, p.Key, prepared.Record.Digest, "sign-test", token, 1)
			if e != nil {
				t.Fatal(e)
			}
			want := map[string]string{"success": "signed_stored", "unknown": "signing_unknown", "expired": "signed_available"}[mode]
			if r.Status != want || calls.Load() != 1 {
				t.Fatal(r, calls.Load())
			}
			var saved []byte
			if e = pool.QueryRow(ctx, `SELECT raw_transaction FROM tickergarden.maintenance_sign_requests WHERE job_key=$1`, p.Key).Scan(&saved); e != nil {
				t.Fatal(e)
			}
			if mode == "unknown" {
				if saved != nil {
					t.Fatal("invented signature")
				}
			} else if hex.EncodeToString(saved) != hex.EncodeToString(raw) {
				t.Fatal("signature evidence lost")
			}
			recoveryID := fmt.Sprintf("0x%064x", 15000+i)
			if mode == "unknown" {
				if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE job_key=$1`, p.Key); e != nil {
					t.Fatal(e)
				}
				if _, e = s.RecoverAuthorization(ctx, f, p, prepared.Record.Digest, "sign-test", token, 1, recoveryID); e == nil {
					t.Fatal("unknown signature reauthorized")
				}
				expectedHash := deployment.Hash(raw)
				if _, e = s.ImportSignature(ctx, p.Key, prepared.Record.Digest, "0x"+strings.Repeat("f", 64), "sign-test", token, 1, raw); e == nil {
					t.Fatal("wrong recovered hash accepted")
				}
				if _, e = s.ImportSignature(ctx, p.Key, prepared.Record.Digest, expectedHash, "sign-test", token, 2, raw); e == nil {
					t.Fatal("wrong import fence accepted")
				}
				altered := append([]byte(nil), raw...)
				altered[len(altered)-1] ^= 1
				if _, e = s.ImportSignature(ctx, p.Key, prepared.Record.Digest, expectedHash, "sign-test", token, 1, altered); e == nil {
					t.Fatal("altered signed bytes accepted")
				}
				var importCount int
				if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_signature_imports WHERE job_key=$1`, p.Key).Scan(&importCount); e != nil || importCount != 0 {
					t.Fatal("failed import persisted", importCount, e)
				}
				var importing sync.WaitGroup
				for range 8 {
					importing.Go(func() {
						result, e := s.ImportSignature(ctx, p.Key, prepared.Record.Digest, expectedHash, "sign-test", token, 1, raw)
						if e != nil || result.Status != "signed_available" {
							t.Error(result, e)
						}
					})
				}
				importing.Wait()
				if _, e = s.Signed(ctx, p.Key); e == nil {
					t.Fatal("import attached without authorization")
				}
				var active bool
				if e = pool.QueryRow(ctx, `SELECT expires_at>clock_timestamp() FROM tickergarden.maintenance_leases WHERE job_key=$1`, p.Key).Scan(&active); e != nil || active {
					t.Fatal("import revived authorization", e)
				}
				if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_signature_imports WHERE job_key=$1 AND imported_by=session_user`, p.Key).Scan(&importCount); e != nil || importCount != 1 {
					t.Fatal("duplicate or missing import audit", importCount, e)
				}
				if _, e = s.RecoverAuthorization(ctx, f, p, prepared.Record.Digest, "sign-test", token, 1, recoveryID); e != nil {
					t.Fatal(e)
				}
				recovered, e := s.Sign(ctx, signer, p.Key, prepared.Record.Digest, "sign-test", token, 1)
				if e != nil || recovered.Status != "signed_stored" || calls.Load() != 1 {
					t.Fatal("import recovery signed again", recovered, e)
				}

			}
			if mode == "expired" {
				if _, e = s.Signed(ctx, p.Key); e == nil {
					t.Fatal("expired lease attached signature")
				}
				broken := f
				broken.bad = true
				if _, e = s.RecoverAuthorization(ctx, broken, p, prepared.Record.Digest, "sign-test", token, 1, recoveryID); e == nil {
					t.Fatal("bad exact simulation reauthorized")
				}
				if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET released=true WHERE job_key=$1`, p.Key); e != nil {
					t.Fatal(e)
				}
				if _, e = s.RecoverAuthorization(ctx, f, p, prepared.Record.Digest, "sign-test", token, 1, recoveryID); e == nil {
					t.Fatal("released lease reauthorized")
				}
				if _, e = pool.Exec(ctx, `UPDATE tickergarden.maintenance_leases SET released=false WHERE job_key=$1`, p.Key); e != nil {
					t.Fatal(e)
				}
				changed := f
				changed.pending = 1
				if _, e = s.RecoverAuthorization(ctx, changed, p, prepared.Record.Digest, "sign-test", token, 1, recoveryID); e == nil {
					t.Fatal("consumed nonce reauthorized")
				}
				wrongChain := f
				wrongChain.wrongChain = true
				if _, e = s.RecoverAuthorization(ctx, wrongChain, p, prepared.Record.Digest, "sign-test", token, 1, recoveryID); e == nil {
					t.Fatal("wrong chain reauthorized")
				}
				var recoveryCount int
				if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.maintenance_authorization_recoveries WHERE job_key=$1`, p.Key).Scan(&recoveryCount); e != nil || recoveryCount != 0 {
					t.Fatal("failed recovery left audit", recoveryCount, e)
				}
				first, e := s.RecoverAuthorization(ctx, f, p, prepared.Record.Digest, "sign-test", token, 1, recoveryID)
				if e != nil {
					t.Fatal(e)
				}
				second, e := s.RecoverAuthorization(ctx, f, p, prepared.Record.Digest, "sign-test", token, 1, recoveryID)
				if e != nil || first != second {
					t.Fatal("recovery ID extended authorization", first, second, e)
				}
				result, e := s.Sign(ctx, signer, p.Key, prepared.Record.Digest, "sign-test", token, 1)
				if e != nil || result.Status != "signed_stored" || calls.Load() != 1 {
					t.Fatal("recovery did not reuse signed bytes", result, calls.Load(), e)
				}
				in, e := s.Intent(ctx, p.Key)
				if e != nil || in.Digest != prepared.Record.Digest || in.Intent.Reservation.Nonce != "0" {
					t.Fatal("recovery changed intent", in, e)
				}
			}
		})
	}
}
