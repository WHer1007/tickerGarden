package integration

// Opt-in real process + HTTP + PostgreSQL drill. The RPC chain is synthetic;
// this tests local service behavior, never public-chain finality or throughput.
import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/postgres"
)

type soakRPC struct {
	head     atomic.Uint64
	outage   atomic.Bool
	delay    atomic.Int64
	requests atomic.Uint64
	bindings *emptyRPC
}

func (r *soakRPC) header(n uint64) chainrpc.Header {
	parent := hash(int(n) - 1)
	if n == 1 {
		parent = r.bindings.m.GenesisHash
	}
	h := hash(int(n))
	if n == 0 {
		h = r.bindings.m.GenesisHash
		parent = hash(0)
	}
	return chainrpc.Header{Number: fmt.Sprintf("0x%x", n), Hash: h, ParentHash: parent, Timestamp: fmt.Sprintf("0x%x", 1700000000+n/4)}
}
func (r *soakRPC) receipts(n uint64) []chainrpc.Receipt {
	h := r.header(n)
	rs := make([]chainrpc.Receipt, 4)
	for i := range rs {
		th := hash(10000000 + int(n)*4 + i)
		ls := make([]chainrpc.Log, 4)
		for j := range ls {
			ls[j] = chainrpc.Log{Address: "0x0000000000000000000000000000000000000001", Topics: []string{}, Data: "0x", BlockHash: h.Hash, BlockNumber: h.Number, TransactionHash: th, TransactionIndex: fmt.Sprintf("0x%x", i), LogIndex: fmt.Sprintf("0x%x", i*4+j)}
		}
		rs[i] = chainrpc.Receipt{TransactionHash: th, TransactionIndex: fmt.Sprintf("0x%x", i), BlockHash: h.Hash, BlockNumber: h.Number, Status: "0x1", Logs: ls}
	}
	return rs
}
func (r *soakRPC) ServeHTTP(w http.ResponseWriter, q *http.Request) {
	r.requests.Add(1)
	if r.outage.Load() {
		http.Error(w, "controlled outage", 503)
		return
	}
	if d := r.delay.Load(); d > 0 {
		select {
		case <-time.After(time.Duration(d)):
		case <-q.Context().Done():
			return
		}
	}
	var in struct {
		ID     int               `json:"id"`
		Method string            `json:"method"`
		Params []json.RawMessage `json:"params"`
	}
	if json.NewDecoder(q.Body).Decode(&in) != nil {
		http.Error(w, "invalid", 400)
		return
	}
	str := func(i int) string { var s string; _ = json.Unmarshal(in.Params[i], &s); return s }
	number := func(s string) uint64 { n, _ := strconv.ParseUint(strings.TrimPrefix(s, "0x"), 16, 64); return n }
	var result any
	switch in.Method {
	case "eth_chainId":
		result = "0xb626"
	case "eth_getBlockByNumber":
		tag := str(0)
		n := number(tag)
		if tag == "latest" {
			n = r.head.Load()
		}
		if tag == "finalized" {
			n = r.head.Load() - 8
		}
		result = r.header(n)
	case "eth_getBlockByHash":
		n := number(str(0))
		h := r.header(n)
		txs := []string{}
		for _, v := range r.receipts(n) {
			txs = append(txs, v.TransactionHash)
		}
		result = struct {
			chainrpc.Header
			Transactions []string `json:"transactions"`
		}{h, txs}
	case "eth_getLogs":
		var f map[string]string
		_ = json.Unmarshal(in.Params[0], &f)
		ls := []chainrpc.Log{}
		for _, v := range r.receipts(number(f["blockHash"])) {
			ls = append(ls, v.Logs...)
		}
		result = ls
	case "eth_getTransactionReceipt":
		v := number(str(0)) - 10000000
		result = r.receipts(v / 4)[v%4]
	case "eth_getCode":
		result = "0x00"
	case "eth_call":
		var c map[string]string
		_ = json.Unmarshal(in.Params[0], &c)
		data := r.bindings.calls[c["to"]+c["data"]]
		if data == nil {
			http.Error(w, "unknown binding", 500)
			return
		}
		result = "0x" + hex.EncodeToString(data)
	default:
		http.Error(w, "method denied", 400)
		return
	}
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": in.ID, "result": result})
}

func TestLocalServiceSustainedRecovery(t *testing.T) {
	if os.Getenv("TG_TEST_STABILITY") != "1" {
		t.Skip("opt-in process and PostgreSQL soak")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	bin := os.Getenv("TG_TEST_SERVICE_BIN")
	out := os.Getenv("TG_TEST_EVIDENCE_DIR")
	if dsn == "" || bin == "" || out == "" {
		t.Fatal("requires isolated PostgreSQL, built service binaries and evidence directory")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	admin, e := pgx.Connect(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_soak_%d", time.Now().UnixNano())
	id := pgx.Identifier{name}.Sanitize()
	if _, e = admin.Exec(ctx, "CREATE DATABASE "+id); e != nil {
		t.Fatal(e)
	}
	defer func() {
		_, e := admin.Exec(context.Background(), "DROP DATABASE "+id+" WITH (FORCE)")
		if e != nil {
			t.Error(e)
		}
	}()
	u, e := url.Parse(dsn)
	if e != nil {
		t.Fatal(e)
	}
	u.Path = "/" + name
	cfg, e := pgx.ParseConfig(u.String())
	if e != nil {
		t.Fatal(e)
	}
	db := stdlib.OpenDB(*cfg)
	provider, e := migration.New(db)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = provider.Up(ctx); e != nil {
		t.Fatal(e)
	}
	db.Close()
	pool, e := postgres.Open(ctx, u.String(), 4)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	r := &soakRPC{bindings: emptyFixture()}
	r.head.Store(120)
	r.delay.Store(int64(2 * time.Millisecond))
	srv := httptest.NewServer(r)
	defer srv.Close()
	manifest := filepath.Join(out, "soak-manifest.json")
	raw, _ := json.Marshal(r.bindings.m)
	if e = os.WriteFile(manifest, raw, 0600); e != nil {
		t.Fatal(e)
	}
	type process struct {
		cmd  *exec.Cmd
		done chan error
		log  *os.File
	}
	var workers []*process
	start := func(service, suffix string) *process {
		log, e := os.Create(filepath.Join(out, service+"-"+suffix+".log"))
		if e != nil {
			t.Fatal(e)
		}
		cmd := exec.Command(filepath.Join(bin, service), "--run")
		cmd.Env = append(os.Environ(), "TG_ENV=test", "TG_CHAIN_ID=46630", "TG_RPC_URL="+srv.URL, "TG_INDEXER_DATABASE_URL="+u.String(), "TG_DISCOVERY_DATABASE_URL="+u.String(), "TG_DEPLOYMENT_MANIFEST="+manifest, "TG_INDEXER_START_BLOCK=1", "TG_DISCOVERY_START_BLOCK=1", "TG_DISCOVERY_EMPTY_BATCH_SIZE=16")
		cmd.Stdout = log
		cmd.Stderr = log
		if e = cmd.Start(); e != nil {
			t.Fatal(e)
		}
		p := &process{cmd: cmd, done: make(chan error, 1), log: log}
		go func() { p.done <- cmd.Wait(); close(p.done) }()
		workers = append(workers, p)
		return p
	}
	stop := func(p *process) {
		_ = p.cmd.Process.Signal(syscall.SIGTERM)
		select {
		case <-p.done:
		case <-time.After(15 * time.Second):
			_ = p.cmd.Process.Kill()
			<-p.done
		}
		_ = p.log.Close()
	}
	defer func() {
		for _, p := range workers {
			stop(p)
		}
	}()
	snapshot := func() map[string]uint64 {
		var tip, fin, dis uint64
		_ = pool.QueryRow(ctx, "SELECT coalesce(tip_number,0),coalesce(finalized_number,0) FROM tickergarden.chain_journal WHERE chain_id=46630").Scan(&tip, &fin)
		_ = pool.QueryRow(ctx, "SELECT coalesce(tip_number,0) FROM tickergarden.discovery_checkpoints WHERE chain_id=46630").Scan(&dis)
		return map[string]uint64{"latest": r.head.Load(), "tip": tip, "finalized": fin, "discovered": dis}
	}
	trace := []map[string]any{}
	record := func(stage string) {
		trace = append(trace, map[string]any{"stage": stage, "at": time.Now().UTC(), "checkpoint": snapshot(), "requests": r.requests.Load()})
	}
	save := func(status string) {
		b, _ := json.MarshalIndent(map[string]any{"status": status, "scope": "Synthetic 4 blocks/second, 4 receipts and 16 logs/block; real service processes, HTTP RPC and PostgreSQL. Not production capacity certification.", "samples": trace}, "", "  ")
		_ = os.WriteFile(filepath.Join(out, "sustained-recovery.json"), b, 0600)
	}
	defer func() {
		if t.Failed() {
			record("failed")
			save("FAIL")
		}
	}()
	waitCaught := func(stage string, budget time.Duration) {
		until := time.Now().Add(budget)
		for time.Now().Before(until) {
			s := snapshot()
			if s["tip"]+12 >= s["latest"] && s["discovered"]+16 >= s["finalized"] && s["discovered"]+24 >= s["latest"]-8 && s["finalized"]+16 >= s["latest"]-8 && s["discovered"] > 0 {
				record(stage)
				return
			}
			time.Sleep(250 * time.Millisecond)
		}
		record(stage + "_timeout")
		t.Fatalf("services did not catch up: %+v", snapshot())
	}
	idx := start("indexer", "initial")
	disc := start("discovery-worker", "initial")
	waitCaught("initial_backlog_caught", 90*time.Second)
	// Real-time source growth continues across process failure/restarts.
	growCtx, growStop := context.WithCancel(ctx)
	defer growStop()
	go func() {
		tick := time.NewTicker(250 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-tick.C:
				r.head.Add(1)
			case <-growCtx.Done():
				return
			}
		}
	}()
	for i := 0; i < 6; i++ {
		time.Sleep(5 * time.Second)
		record("sustained_growth")
	}
	waitCaught("steady_state_caught", 45*time.Second)
	// RPC outage causes explicit process failure. Allow in-flight DB work to finish,
	// then assert the durable checkpoint does not advance while RPC stays down.
	r.outage.Store(true)
	time.Sleep(2 * time.Second)
	stop(idx)
	stop(disc)
	for _, service := range []string{"indexer", "discovery-worker"} {
		raw, err := os.ReadFile(filepath.Join(out, service+"-initial.log"))
		if err != nil || !strings.Contains(string(raw), "RPC HTTP status 503") {
			t.Fatalf("%s did not record actual RPC outage: %v", service, err)
		}
	}
	a := snapshot()
	time.Sleep(3 * time.Second)
	b := snapshot()
	if a["tip"] != b["tip"] || a["finalized"] != b["finalized"] || a["discovered"] != b["discovered"] {
		t.Fatal("outage changed durable checkpoints")
	}
	record("rpc_outage_checkpoint_preserved")
	r.outage.Store(false)
	idx = start("indexer", "rpc-recovered")
	disc = start("discovery-worker", "rpc-recovered")
	waitCaught("rpc_recovered_caught", 90*time.Second)
	// Abrupt death during writes must leave either a full block or no block.
	_ = idx.cmd.Process.Kill()
	<-idx.done
	_ = idx.log.Close()
	record("indexer_sigkill")
	idx = start("indexer", "sigkill-recovered")
	waitCaught("sigkill_recovered_caught", 60*time.Second)
	for i := 0; i < 6; i++ {
		time.Sleep(5 * time.Second)
		record("post_restart_sustained_growth")
	}
	waitCaught("post_restart_steady", 45*time.Second)
	// Higher RTT is a separate measured capacity envelope, not a forced PASS.
	r.delay.Store(int64(50 * time.Millisecond))
	before := snapshot()
	time.Sleep(12 * time.Second)
	after := snapshot()
	trace = append(trace, map[string]any{"stage": "50ms_rpc_latency_envelope", "before": before, "after": after, "keptUp": after["latest"]-after["tip"] <= before["latest"]-before["tip"], "seconds": 12})
	r.delay.Store(int64(2 * time.Millisecond))
	waitCaught("latency_recovered", 90*time.Second)
	growStop()
	stop(idx)
	stop(disc)
	last := snapshot()
	var gaps, bad int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM (SELECT number,parent_hash,lag(hash) OVER(ORDER BY number) ph,lag(number) OVER(ORDER BY number) p FROM tickergarden.chain_blocks WHERE chain_id=46630 AND canonical) s WHERE p IS NOT NULL AND (number<>p+1 OR parent_hash<>ph)`).Scan(&gaps); e != nil || gaps != 0 {
		t.Fatal("gap", gaps, e)
	}
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.chain_blocks b WHERE chain_id=46630 AND canonical AND (NOT receipts_verified OR receipt_count<>4 OR receipt_set_hash IS NULL OR (SELECT count(*) FROM tickergarden.chain_receipts r WHERE r.chain_id=b.chain_id AND r.block_hash=b.hash)<>4 OR (SELECT count(*) FROM tickergarden.chain_logs l WHERE l.chain_id=b.chain_id AND l.block_hash=b.hash)<>16)`).Scan(&bad); e != nil || bad != 0 {
		t.Fatal("partial block", bad, e)
	}
	var count uint64
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden.chain_blocks WHERE chain_id=46630 AND canonical").Scan(&count); e != nil || count != last["tip"] {
		t.Fatal("duplicate or missing blocks", count, last, e)
	}
	rows, err := pool.Query(ctx, `SELECT b.receipt_set_hash,jsonb_agg(r.payload ORDER BY r.transaction_index) FROM tickergarden.chain_blocks b JOIN tickergarden.chain_receipts r ON r.chain_id=b.chain_id AND r.block_hash=b.hash WHERE b.chain_id=46630 AND b.canonical GROUP BY b.number,b.receipt_set_hash ORDER BY b.number`)
	if err != nil {
		t.Fatal(err)
	}
	checked := uint64(0)
	for rows.Next() {
		var expected string
		var raw []byte
		if err = rows.Scan(&expected, &raw); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		var receipts []chainrpc.Receipt
		if err = json.Unmarshal(raw, &receipts); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		actual, err := chainrpc.ReceiptSetCommitment(receipts)
		if err != nil || actual != expected {
			rows.Close()
			t.Fatal("restored receipt commitment mismatch", err)
		}
		checked++
	}
	err = rows.Err()
	rows.Close()
	if err != nil || checked != count {
		t.Fatal("receipt commitment coverage", checked, count, err)
	}
	record("contiguous_receipts_logs_and_checkpoints_verified")
	save("PASS")
	t.Logf("sustained recovery PASS: %d blocks, %d receipts, %d logs, %d RPC calls", count, count*4, count*16, r.requests.Load())
}
