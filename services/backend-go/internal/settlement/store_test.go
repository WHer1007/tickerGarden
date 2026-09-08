package settlement

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"testing"
	"tickergarden/backend/internal/postgres"
	"time"
)

func TestEmptyVerifiedConversionRejected(t *testing.T) {
	if _, err := (Store{}).Record(context.Background(), VerifiedConversion{}); err == nil {
		t.Fatal("accepted empty result")
	}
	v := VerifiedConversion{payload: []byte(`{"a":1}`)}
	copy := v.Result()
	copy[0] = 'x'
	if v.payload[0] != '{' {
		t.Fatal("mutable result")
	}
}

func TestIsolatedSettlementChecks(t *testing.T) {
	dsn := os.Getenv("TG_SETTLEMENT_TEST_DSN")
	if dsn == "" {
		t.Skip("isolated settlement database not supplied")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := postgres.Open(ctx, dsn, 8)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var v VerifiedConversion
	var raw []byte
	var seq int64
	err = pool.QueryRow(ctx, `SELECT sequence,chain_id,genesis_hash,market_id,request_digest,block_hash,payload FROM tickergarden.settlement_checks ORDER BY sequence LIMIT 1`).Scan(&seq, &v.chainID, &v.genesis, &v.market, &v.request, &v.block, &raw)
	if err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Manifest json.RawMessage
		Result   json.RawMessage
	}
	if json.Unmarshal(raw, &envelope) != nil {
		t.Fatal("bad envelope")
	}
	v.manifest = envelope.Manifest
	v.payload = envelope.Result
	store := Store{Pool: pool, ChainID: v.chainID}
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := store.Record(ctx, v)
			if e != nil || r.Sequence != seq {
				t.Errorf("duplicate %v %v", r, e)
			}
		}()
	}
	wg.Wait()
	history, err := store.History(ctx, v.genesis, v.market, 0)
	if err != nil || len(history) != 5 || history[0].Sequence != seq {
		t.Fatal(history, err)
	}
	if h, e := store.History(ctx, v.genesis, v.market, history[len(history)-1].Sequence); e != nil || len(h) != 0 {
		t.Fatal("cursor", h, e)
	}
	for _, scope := range [][2]string{{"0x" + strings.Repeat("9", 64), v.market}, {v.genesis, "0x" + strings.Repeat("9", 64)}} {
		if h, e := store.History(ctx, scope[0], scope[1], 0); e != nil || len(h) != 0 {
			t.Fatal("scope", h, e)
		}
	}
	if _, err := (Store{Pool: pool, ChainID: 1}).Record(ctx, v); err == nil {
		t.Fatal("wrong chain")
	}
	if _, err := store.Record(ctx, VerifiedConversion{}); err == nil {
		t.Fatal("empty")
	}
	if _, err := pool.Exec(ctx, `UPDATE tickergarden.settlement_checks SET block_hash=$1 WHERE sequence=$2`, "0x"+strings.Repeat("8", 64), seq); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Record(ctx, v); err == nil {
		t.Fatal("accepted changed metadata")
	}
	if _, err := store.History(ctx, v.genesis, v.market, 0); err == nil {
		t.Fatal("history accepted changed metadata")
	}
	if _, err := pool.Exec(ctx, `UPDATE tickergarden.settlement_checks SET block_hash=$1,payload=$2 WHERE sequence=$3`, v.block, []byte(`{}`), seq); err != nil {
		t.Fatal(err)
	}
	if _, err := store.History(ctx, v.genesis, v.market, 0); err == nil {
		t.Fatal("history accepted corruption")
	}
	if _, err := pool.Exec(ctx, `UPDATE tickergarden.settlement_checks SET payload=$1 WHERE sequence=$2`, raw, seq); err != nil {
		t.Fatal(err)
	}
}
