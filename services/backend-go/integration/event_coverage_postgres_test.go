package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/journal"
	"tickergarden/backend/internal/migration"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func coverageHeader(t *testing.T, n uint64, parent common.Hash, bloom types.Bloom) (chainrpc.Header, []byte) {
	t.Helper()
	h := types.Header{ParentHash: parent, Number: new(big.Int).SetUint64(n), Difficulty: big.NewInt(1), GasLimit: 30_000_000, GasUsed: 21_000, Time: 100 + n, Bloom: bloom, UncleHash: types.EmptyUncleHash, TxHash: types.EmptyTxsHash, ReceiptHash: types.EmptyReceiptsHash}
	hash := h.Hash()
	b, _ := json.Marshal(&h)
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(b, &fields); err != nil {
		t.Fatal(err)
	}
	fields["hash"], _ = json.Marshal(hash.Hex())
	fields["number"], _ = json.Marshal(fmt.Sprintf("0x%x", n))
	b, _ = json.Marshal(fields)
	return chainrpc.Header{Number: fmt.Sprintf("0x%x", n), Hash: hash.Hex(), ParentHash: parent.Hex(), Timestamp: fmt.Sprintf("0x%x", 100+n)}, b
}

func TestEventCoveragePostgres(t *testing.T) {
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TG_TEST_DATABASE_URL to a local PostgreSQL server")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_event_coverage_%d", time.Now().UnixNano())
	ident := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+ident); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(context.Background(), "DROP DATABASE "+ident+" WITH (FORCE)") }()
	tcfg := cfg.Copy()
	tcfg.Database = name
	db := stdlib.OpenDB(*tcfg)
	defer db.Close()
	readConn, err := pgx.ConnectConfig(ctx, tcfg)
	if err != nil {
		t.Fatal(err)
	}
	defer readConn.Close(context.Background())
	m, err := migration.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.Up(ctx); err != nil {
		t.Fatal(err)
	}
	chain := uint64(4663)
	genesis := common.HexToHash("0x" + strings.Repeat("aa", 32))
	h1, raw1 := coverageHeader(t, 1, genesis, types.Bloom{})
	h2, raw2 := coverageHeader(t, 2, common.HexToHash(h1.Hash), types.Bloom{})
	emitter := "0x1111111111111111111111111111111111111111"
	commit, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{})
	if _, err = db.ExecContext(ctx, `INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,finalized_number,finalized_hash) VALUES($1,$2,1,2,$3)`, chain, genesis.Hex(), h2.Hash); err != nil {
		t.Fatal(err)
	}
	for _, b := range []struct {
		n   uint64
		h   chainrpc.Header
		raw []byte
	}{{1, h1, raw1}, {2, h2, raw2}} {
		if _, err = db.ExecContext(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,canonical,receipts_verified,receipt_count,receipt_set_hash,receipts_root,root_receipt_set_hash,event_exclusion_header) VALUES($1,$2,$3,$4,$5,true,false,0,$6,NULL,NULL,$7)`, chain, b.n, b.h.Hash, b.h.ParentHash, 100+b.n, commit, b.raw); err != nil {
			t.Fatal(err)
		}
	}
	check := func() (bool, error) {
		tx, e := readConn.Begin(ctx)
		if e != nil {
			return false, e
		}
		defer tx.Rollback(ctx)
		return journal.VerifyStoredReceiptHistory(ctx, tx, chain, 1, 2, h1.Hash, h2.Hash)
	}
	if ok, err := check(); err == nil || ok {
		t.Fatalf("unverified receipt history accepted: %v, %v", ok, err)
	}
	tx, err := readConn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := journal.VerifyStoredEventExclusions(ctx, tx, chain, 1, 2, map[string]uint64{emitter: 1})
	_ = tx.Rollback(ctx)
	if err != nil || !ok {
		t.Fatalf("event exclusions = %v, %v", ok, err)
	}
	tx, _ = readConn.Begin(ctx)
	if err = journal.VerifyStoredReceiptRoot(ctx, tx, chain, 1, h1.Hash); err == nil {
		t.Fatal("receipt root accepted unverified block")
	}
	_ = tx.Rollback(ctx)
	if _, err = db.ExecContext(ctx, `UPDATE tickergarden.chain_blocks SET event_exclusion_header=event_exclusion_header::jsonb || '{"hash":"0xdead"}'::jsonb WHERE chain_id=$1 AND number=1`, chain); err != nil {
		t.Fatal(err)
	}
	if ok, _ := check(); ok {
		t.Fatal("tampered exclusion header accepted")
	}
	if _, err = db.ExecContext(ctx, `DELETE FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=2`, chain); err != nil {
		t.Fatal(err)
	}
	if ok, err := check(); err == nil || ok {
		t.Fatalf("chain gap result = %v,%v", ok, err)
	}
}
