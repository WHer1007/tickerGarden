package integration

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/treasury"
)

type requestDiscoveryRPC struct {
	manifest         deployment.Manifest
	block, source    chainrpc.Header
	calls            map[string][]byte
	headers, reorgAt int
}

func (r *requestDiscoveryRPC) ChainID(context.Context) (uint64, error) {
	return r.manifest.ChainID, nil
}
func (r *requestDiscoveryRPC) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	if tag == "0x0" {
		return chainrpc.Header{Number: tag, Hash: r.manifest.GenesisHash, Timestamp: "0x0"}, nil
	}
	if tag == r.source.Number {
		return r.source, nil
	}
	b := r.block
	r.headers++
	if r.reorgAt > 0 && r.headers >= r.reorgAt {
		b.Hash = hash(9999)
	}
	return b, nil
}
func (r *requestDiscoveryRPC) CodeAt(_ context.Context, _ string, h string) ([]byte, error) {
	if h != r.block.Hash {
		return nil, errors.New("unpinned runtime")
	}
	return []byte{0}, nil
}
func (r *requestDiscoveryRPC) CallAt(_ context.Context, a, data, h string) ([]byte, error) {
	if h != r.block.Hash {
		return nil, errors.New("unpinned request call")
	}
	b, ok := r.calls[a+data]
	if !ok {
		return nil, fmt.Errorf("unexpected fixture ABI %s", data)
	}
	return b, nil
}
func discoveryRPC(c treasury.Candidate) *requestDiscoveryRPC {
	sourceN, _ := strconv.ParseUint(c.Input.SourceBlockNumber, 10, 64)
	sourceT, _ := strconv.ParseUint(c.Input.SourceBlockTimestamp, 10, 64)
	r := &requestDiscoveryRPC{manifest: deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: c.Journal.ChainID, GenesisHash: hash(110)}, block: chainrpc.Header{Number: c.Request.BlockNumber, Hash: c.Request.BlockHash, Timestamp: fmt.Sprintf("0x%x", sourceT+1)}, source: chainrpc.Header{Number: fmt.Sprintf("0x%x", sourceN), Hash: c.Input.SourceBlockHash, Timestamp: fmt.Sprintf("0x%x", sourceT)}, calls: map[string][]byte{}}
	modules := []string{"TickerGardenFactoryV1", "OfficialStockRegistryV1", "ApprovedQuoteRegistry", "TickerGardenBaselineRegistry", "LaunchTemplateRegistry", "MarketRegistryV1", "ProtocolFeeVault", "AllocationManager", "LaunchAndBuyRouter", "TreasuryDistributorV1"}
	roots := map[string]string{}
	for i, m := range modules {
		a := fmt.Sprintf("0x%040x", i+900)
		if m == "TreasuryDistributorV1" {
			a = c.Input.Distributor
		}
		roots[m] = a
		r.manifest.Contracts = append(r.manifest.Contracts, deployment.Contract{Module: m, Address: a, RuntimeCodeHash: deployment.Hash([]byte{0})})
	}
	hw := func(s string) []byte {
		b, _ := hex.DecodeString(fmt.Sprintf("%064s", strings.TrimPrefix(s, "0x")))
		return b
	}
	nw := func(n uint64) []byte { return hw(fmt.Sprintf("%x", n)) }
	dec := func(s string) []byte { n, _ := strconv.ParseUint(s, 10, 64); return nw(n) }
	set := func(module, sig, args string, words ...[]byte) {
		var b []byte
		for _, w := range words {
			b = append(b, w...)
		}
		r.calls[roots[module]+deployment.Hash([]byte(sig))[:10]+args] = b
	}
	var runtime [][]byte
	for _, m := range modules[1:9] {
		runtime = append(runtime, hw(roots[m]))
	}
	set(modules[0], "runtimeBindings()", "", runtime...)
	for _, edge := range [][3]string{{modules[5], "factory()", modules[0]}, {modules[5], "officialStockRegistry()", modules[1]}, {modules[5], "approvedQuoteRegistry()", modules[2]}, {modules[5], "tickerGardenBaselineRegistry()", modules[3]}, {modules[5], "launchTemplateRegistry()", modules[4]}, {modules[2], "officialStockRegistry()", modules[1]}, {modules[0], "treasuryDistributor()", modules[9]}, {modules[9], "marketRegistry()", modules[5]}} {
		set(edge[0], edge[1], "", hw(roots[edge[2]]))
	}
	market := make([][]byte, 20)
	for i := range market {
		market[i] = nw(0)
	}
	market[9] = hw(c.Input.MemeToken)
	market[12] = hw(c.Input.QuoteToken)
	set(modules[5], "market(bytes32)", c.Input.MarketID[2:], market...)
	d := modules[9]
	args := c.Input.MarketID[2:] + fmt.Sprintf("%064x", c.Input.EpochID)
	set(d, "market(bytes32)", c.Input.MarketID[2:], hw(c.Input.MemeToken), hw(c.Input.QuoteToken), hw(c.Input.EligibilityPolicyHash), nw(100))
	set(d, "epoch(bytes32,uint32)", args, nw(sourceT+1), nw(sourceT+100), nw(0), nw(0), nw(sourceN), nw(0), nw(1), hw(c.Input.Distributor), hw(c.Input.QuoteToken), nw(1), hw(c.Input.SourceBlockHash), nw(0), nw(0), dec(c.Input.QuoteAmount), nw(0), nw(0))
	set(d, "epochQuoteAmount(bytes32,uint32)", args, dec(c.Input.QuoteAmount))
	set(d, "epochWindow(bytes32,uint32)", args, dec(c.Input.WindowStart), dec(c.Input.WindowEnd))
	set(d, "EPOCH_DURATION()", "", nw(treasury.Duration))
	set(d, "TWAB_SCHEMA()", "", hw(deployment.Hash([]byte("TRANSFER_LOG_TWAB_7D_V1"))))
	return r
}
func testTreasuryRequestDiscovery(t *testing.T, ctx context.Context, pool *pgxpool.Pool, c treasury.Candidate) {
	t.Helper()
	rpc := discoveryRPC(c)
	chain := c.Journal.ChainID
	sourceTime, _ := strconv.ParseUint(c.Input.SourceBlockTimestamp, 10, 64)
	word := func(s string) string { return fmt.Sprintf("%064s", strings.TrimPrefix(s, "0x")) }
	uintWord := func(n uint64) string { return fmt.Sprintf("%064x", n) }
	log := chainrpc.Log{Address: c.Input.Distributor, BlockHash: c.Request.BlockHash, BlockNumber: c.Request.BlockNumber, TransactionHash: hash(920), TransactionIndex: "0x0", LogIndex: "0x0", Topics: []string{deployment.Hash([]byte("RootRequested(bytes32,uint32,address,uint64,uint64,uint64,bytes32,uint256,address,uint128,uint64)")), c.Input.MarketID, "0x" + uintWord(uint64(c.Input.EpochID)), "0x" + word(c.Input.Distributor)}}
	start, _ := strconv.ParseUint(c.Input.WindowStart, 10, 64)
	end, _ := strconv.ParseUint(c.Input.WindowEnd, 10, 64)
	source, _ := strconv.ParseUint(c.Input.SourceBlockNumber, 10, 64)
	quote, _ := strconv.ParseUint(c.Input.QuoteAmount, 10, 64)
	log.Data = "0x" + uintWord(start) + uintWord(end) + uintWord(source) + word(c.Input.SourceBlockHash) + uintWord(quote) + word(c.Input.QuoteToken) + uintWord(1) + uintWord(sourceTime+100)
	raw, _ := json.Marshal(log)
	if _, e := pool.Exec(ctx, `INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,0,$3,$4)`, chain, log.BlockHash, log.Address, raw); e != nil {
		t.Fatal(e)
	}
	policies := []treasury.EligibilityPolicy{{ChainID: chain, MarketID: c.Input.MarketID, PolicyHash: c.Input.EligibilityPolicyHash, ExcludedAccounts: c.Input.ExcludedAccounts}}
	if _, e := treasury.DiscoverRequests(ctx, pool, rpc, rpc.manifest, policies); e == nil {
		t.Fatal("missing receipt accepted")
	}
	receipt := chainrpc.Receipt{BlockHash: log.BlockHash, BlockNumber: log.BlockNumber, TransactionHash: log.TransactionHash, TransactionIndex: log.TransactionIndex, Status: "0x1", Logs: []chainrpc.Log{log}}
	receiptBytes, _ := json.Marshal(receipt)
	if _, e := pool.Exec(ctx, `INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,0,'0x1',$4)`, chain, log.BlockHash, log.TransactionHash, receiptBytes); e != nil {
		t.Fatal(e)
	}
	stampTreasuryRequestRoot(t, ctx, pool, chain, log.BlockHash)
	var jobsBefore, jobsAfter int
	if e := pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.treasury_jobs WHERE chain_id=$1`, chain).Scan(&jobsBefore); e != nil {
		t.Fatal(e)
	}
	// The fifth observation-block read is the final discovery check after enqueue.
	rpc.headers = 0
	rpc.reorgAt = 5
	if _, e := treasury.DiscoverRequests(ctx, pool, rpc, rpc.manifest, policies); e == nil {
		t.Fatal("late reorg accepted")
	}
	var mappings int
	if e := pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.treasury_request_discovery WHERE chain_id=$1`, chain).Scan(&mappings); e != nil || mappings != 0 {
		t.Fatal("failed discovery partially committed", mappings, e)
	}
	if e := pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.treasury_jobs WHERE chain_id=$1`, chain).Scan(&jobsAfter); e != nil || jobsAfter != jobsBefore {
		t.Fatal("failed discovery left orphan job", jobsBefore, jobsAfter, e)
	}
	rpc.reorgAt = 0
	rpc.headers = 0
	epochKey := c.Input.Distributor + deployment.Hash([]byte("epoch(bytes32,uint32)"))[:10] + c.Input.MarketID[2:] + uintWord(uint64(c.Input.EpochID))
	rpc.calls[epochKey][10*32-1] = 2
	if _, e := treasury.DiscoverRequests(ctx, pool, rpc, rpc.manifest, policies); e == nil {
		t.Fatal("event/service fee mismatch hidden as inactive")
	}
	rpc.calls[epochKey][10*32-1] = 1
	got, e := treasury.DiscoverRequests(ctx, pool, rpc, rpc.manifest, []treasury.EligibilityPolicy{})
	if e != nil || got.AwaitingPolicy != 1 || got.Queued != 0 {
		t.Fatal("unknown policy not held", got, e)
	}
	got, e = treasury.DiscoverRequests(ctx, pool, rpc, rpc.manifest, []treasury.EligibilityPolicy{})
	if e != nil || got.AwaitingPolicy != 0 {
		t.Fatal("unchanged policy retried indefinitely", got, e)
	}
	got, e = treasury.DiscoverRequests(ctx, pool, rpc, rpc.manifest, policies)
	if e != nil || got.Queued != 1 {
		t.Fatal("known policy not enqueued", got, e)
	}
	got, e = treasury.DiscoverRequests(ctx, pool, rpc, rpc.manifest, policies)
	if e != nil || got.Queued != 0 {
		t.Fatal("event replay duplicated queue", got, e)
	}
	// Full processor success: frozen input comes from event/state, history comes
	// from PostgreSQL, candidate persistence and job completion use real DB calls.
	// RPC finality can advance while ingestion is still at the prior finalized
	// snapshot. Candidate creation must retain that journal's authenticated pin.
	job, e := treasury.ProcessJobOnce(ctx, treasury.JobQueue{Pool: pool}, pool, aheadFinalizedRPC{rpc}, rpc.manifest)
	if e != nil || job.State != "succeeded" || job.CandidateID == nil {
		t.Fatal("discovered job failed", job, e)
	}
	saved, e := treasury.ReadCandidate(ctx, pool, *job.CandidateID)
	if e != nil || saved.Dataset.MerkleRoot != c.Dataset.MerkleRoot || !saved.Journal.RootRequestVerified {
		t.Fatal("discovered candidate mismatch", e)
	}
	// Already published historical events are recorded inactive, not retried jobs.
	log.LogIndex = "0x1"
	log.TransactionHash = hash(921)
	log.TransactionIndex = "0x1"
	raw, _ = json.Marshal(log)
	if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,1,$3,$4)`, chain, log.BlockHash, log.Address, raw); e != nil {
		t.Fatal(e)
	}
	receipt.TransactionHash = log.TransactionHash
	receipt.TransactionIndex = log.TransactionIndex
	receipt.Logs = []chainrpc.Log{log}
	receiptBytes, _ = json.Marshal(receipt)
	if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,1,'0x1',$4)`, chain, log.BlockHash, log.TransactionHash, receiptBytes); e != nil {
		t.Fatal(e)
	}
	stampTreasuryRequestRoot(t, ctx, pool, chain, log.BlockHash)
	key := c.Input.Distributor + deployment.Hash([]byte("epoch(bytes32,uint32)"))[:10] + c.Input.MarketID[2:] + uintWord(uint64(c.Input.EpochID))
	rpc.calls[key][7*32-1] = 2
	got, e = treasury.DiscoverRequests(ctx, pool, rpc, rpc.manifest, policies)
	if e != nil || got.Inactive != 1 || got.Queued != 0 {
		t.Fatal("published request not skipped", got, e)
	}
	testTreasuryRecovery(t, ctx, pool, c, rpc)
}

// Refresh synthetic block evidence after this fixture changes its receipts.
func stampTreasuryRequestRoot(t *testing.T, ctx context.Context, pool *pgxpool.Pool, chain uint64, bh string) {
	t.Helper()
	rows, err := pool.Query(ctx, `SELECT payload FROM tickergarden.chain_receipts WHERE chain_id=$1 AND block_hash=$2 ORDER BY transaction_index`, chain, bh)
	if err != nil {
		t.Fatal(err)
	}
	receipts := []chainrpc.Receipt{}
	for rows.Next() {
		var raw []byte
		var r chainrpc.Receipt
		if rows.Scan(&raw) != nil || json.Unmarshal(raw, &r) != nil {
			rows.Close()
			t.Fatal("receipt fixture")
		}
		receipts = append(receipts, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		t.Fatal(err)
	}
	digest, err := chainrpc.ReceiptSetCommitment(receipts)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipt_count=$3,receipt_set_hash=$4,receipts_root=$5,root_receipt_set_hash=$4 WHERE chain_id=$1 AND hash=$2`, chain, bh, len(receipts), digest, hash(557)); err != nil {
		t.Fatal(err)
	}
}
