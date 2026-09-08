package integration

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/discovery"
)

type emptyRPC struct {
	m          deployment.Manifest
	headers    map[string]chainrpc.Header
	calls      map[string][]byte
	logs       map[string][]chainrpc.Log
	fail       string
	codeReads  atomic.Int64
	observeNow atomic.Int64
	observeMax atomic.Int64
	finalReads int
}

func (r *emptyRPC) ChainID(context.Context) (uint64, error) { return r.m.ChainID, nil }
func (r *emptyRPC) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	if tag == "finalized" {
		return r.headers["0x4"], nil
	}
	if tag == "0x4" {
		r.finalReads++
		if r.fail == "reorg" && r.finalReads >= 3 {
			h := r.headers[tag]
			h.Hash = hash(777)
			return h, nil
		}
	}
	h, ok := r.headers[tag]
	if !ok {
		return h, errors.New("missing header")
	}
	return h, nil
}
func (r *emptyRPC) CodeAt(context.Context, string, string) ([]byte, error) {
	r.codeReads.Add(1)
	if r.fail == "code" {
		return []byte{9}, nil
	}
	return []byte{0}, nil
}
func (r *emptyRPC) CallAt(_ context.Context, a, d, h string) ([]byte, error) {
	if r.fail == "binding" {
		return nil, errors.New("bad binding")
	}
	v, ok := r.calls[a+d]
	if !ok {
		return nil, errors.New("missing call")
	}
	return v, nil
}
func (r *emptyRPC) Observe(_ context.Context, h chainrpc.Header) (chainrpc.Observation, error) {
	active := r.observeNow.Add(1)
	defer r.observeNow.Add(-1)
	for maximum := r.observeMax.Load(); active > maximum && !r.observeMax.CompareAndSwap(maximum, active); maximum = r.observeMax.Load() {
	}
	// Keep the fixture call live briefly so the bounded-concurrency regression
	// is deterministic under the race detector.
	time.Sleep(2 * time.Millisecond)
	if r.fail == "rpc" {
		return chainrpc.Observation{}, errors.New("outage")
	}
	logs := r.logs[h.Hash]
	if logs == nil {
		logs = []chainrpc.Log{}
	}
	return chainrpc.Observation{Logs: logs}, nil
}
func emptyFixture() *emptyRPC {
	r := &emptyRPC{m: deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 46630, GenesisHash: hash(900)}, headers: map[string]chainrpc.Header{}, calls: map[string][]byte{}, logs: map[string][]chainrpc.Log{}}
	names := []string{"TickerGardenFactoryV1", "OfficialStockRegistryV1", "ApprovedQuoteRegistry", "TickerGardenBaselineRegistry", "LaunchTemplateRegistry", "MarketRegistryV1", "ProtocolFeeVault", "AllocationManager", "LaunchAndBuyRouter"}
	roots := map[string]string{}
	for i, n := range names {
		a := fmt.Sprintf("0x%040x", i+100)
		roots[n] = a
		r.m.Contracts = append(r.m.Contracts, deployment.Contract{Module: n, Address: a, RuntimeCodeHash: deployment.Hash([]byte{0})})
	}
	word := func(a string) []byte {
		b, _ := hex.DecodeString(strings.Repeat("0", 24) + strings.TrimPrefix(a, "0x"))
		return b
	}
	set := func(n, s string, addresses ...string) {
		var data []byte
		for _, a := range addresses {
			data = append(data, word(a)...)
		}
		r.calls[roots[n]+deployment.Hash([]byte(s))[:10]] = data
	}
	var runtime []string
	for _, n := range names[1:] {
		runtime = append(runtime, roots[n])
	}
	set(names[0], "runtimeBindings()", runtime...)
	for _, e := range [][3]string{{names[5], "factory()", names[0]}, {names[5], "officialStockRegistry()", names[1]}, {names[5], "approvedQuoteRegistry()", names[2]}, {names[5], "tickerGardenBaselineRegistry()", names[3]}, {names[5], "launchTemplateRegistry()", names[4]}, {names[2], "officialStockRegistry()", names[1]}} {
		set(e[0], e[1], roots[e[2]])
	}
	r.headers["0x0"] = chainrpc.Header{Number: "0x0", Hash: r.m.GenesisHash, ParentHash: hash(0), Timestamp: "0x0"}
	for n := 1; n <= 4; n++ {
		parent := r.m.GenesisHash
		if n > 1 {
			parent = hash(n - 1)
		}
		tag := fmt.Sprintf("0x%x", n)
		r.headers[tag] = chainrpc.Header{Number: tag, Hash: hash(n), ParentHash: parent, Timestamp: fmt.Sprintf("0x%x", 100+n)}
	}
	return r
}
func testDiscoveryBatches(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	for _, scenario := range []string{"batch", "default", "creation", "rpc", "logs", "gap", "parent", "reorg", "code", "binding"} {
		t.Run("discovery_empty_"+scenario, func(t *testing.T) {
			must := func(e error) {
				if e != nil {
					t.Fatal(e)
				}
			}
			_, e := pool.Exec(ctx, "TRUNCATE tickergarden.chain_journal CASCADE")
			must(e)
			// Reset only the isolated integration database fixture.
			_, e = pool.Exec(ctx, "TRUNCATE tickergarden.discovery_checkpoints CASCADE")
			must(e)
			r := emptyFixture()
			_, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES(46630,$1,1,4,$2,4,$2)`, r.m.GenesisHash, hash(4))
			must(e)
			for n := 1; n <= 4; n++ {
				h := r.headers[fmt.Sprintf("0x%x", n)]
				_, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,canonical,receipts_verified,block_timestamp) VALUES(46630,$1,$2,$3,true,true,$4)`, n, h.Hash, h.ParentHash, 100+n)
				must(e)
			}
			if scenario == "creation" || scenario == "logs" {
				h := r.headers["0x3"]
				l := chainrpc.Log{Address: r.m.Contracts[0].Address, BlockHash: h.Hash, BlockNumber: h.Number, LogIndex: "0x0", TransactionIndex: "0x0", TransactionHash: hash(800), Data: "0x", Topics: []string{deployment.Hash([]byte("MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)"))}}
				raw, _ := json.Marshal(l)
				_, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES(46630,$1,0,$2,$3)`, h.Hash, l.Address, raw)
				must(e)
				if scenario == "creation" {
					r.logs[h.Hash] = []chainrpc.Log{l}
				}
			}
			if scenario == "gap" {
				_, e = pool.Exec(ctx, "DELETE FROM tickergarden.chain_blocks WHERE chain_id=46630 AND number=2")
				must(e)
			}
			if scenario == "parent" {
				_, e = pool.Exec(ctx, "UPDATE tickergarden.chain_blocks SET parent_hash=$1 WHERE chain_id=46630 AND number=2", hash(999))
				must(e)
			}
			r.fail = scenario
			size := uint64(4)
			if scenario == "default" {
				size = 0
			}
			w := discovery.Worker{Pool: pool, RPC: r, Manifest: r.m, StartBlock: 1, EmptyBatchSize: size}
			result, err := w.Step(ctx)
			var tip *uint64
			must(pool.QueryRow(ctx, "SELECT max(tip_number) FROM tickergarden.discovery_checkpoints WHERE chain_id=46630").Scan(&tip))
			if scenario == "batch" || scenario == "default" || scenario == "creation" {
				want := uint64(4)
				if scenario == "default" {
					want = 1
				}
				if scenario == "creation" {
					want = 2
				}
				if err != nil || tip == nil || *tip != want {
					t.Fatalf("result=%+v err=%v tip=%v want=%d", result, err, tip, want)
				}
				var count int
				must(pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden.discovery_batches WHERE chain_id=46630").Scan(&count))
				if count != int(want) {
					t.Fatalf("missing batch markers: %d", count)
				}
				if scenario == "batch" && r.codeReads.Load() != 18 {
					t.Fatalf("expected exactly two boundary runtime checks: %d", r.codeReads.Load())
				}
				if scenario == "batch" && r.observeMax.Load() < 2 {
					t.Fatalf("expected concurrent receipt observations: %d", r.observeMax.Load())
				}
			} else {
				if err == nil || tip != nil {
					t.Fatalf("failure advanced checkpoint: result=%+v err=%v tip=%v", result, err, tip)
				}
				var count int
				must(pool.QueryRow(ctx, "SELECT count(*) FROM tickergarden.discovery_batches WHERE chain_id=46630").Scan(&count))
				if count != 0 {
					t.Fatal("failure committed partial batches")
				}
			}
		})
	}
	_, e := pool.Exec(ctx, "TRUNCATE tickergarden.chain_journal CASCADE; TRUNCATE tickergarden.discovery_checkpoints CASCADE")
	if e != nil {
		t.Fatal(e)
	}
}
