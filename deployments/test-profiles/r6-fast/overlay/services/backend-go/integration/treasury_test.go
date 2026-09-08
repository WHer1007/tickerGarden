package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/treasury"
)

func testTreasuryHistory(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	const chain = 4663
	zero := "0x" + strings.Repeat("0", 40)
	token := "0x" + strings.Repeat("1", 40)
	curve := "0x" + strings.Repeat("2", 40)
	factory := "0x" + strings.Repeat("3", 40)
	user := "0x" + strings.Repeat("4", 40)
	marketID := hash(111)
	sourceHash := hash(113)
	creationHash := hash(112)
	_, e := pool.Exec(ctx, `INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES($1,$2,1,2,$3,2,$3)`, chain, hash(110), sourceHash)
	if e != nil {
		t.Fatal(e)
	}
	end := uint64(100) + treasury.Duration
	for _, b := range []struct {
		n            int
		hash, parent string
		time         uint64
	}{{1, creationHash, hash(110), 100}, {2, sourceHash, creationHash, end + 1}} {
		if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES($1,$2,$3,$4,$5,true)`, chain, b.n, b.hash, b.parent, b.time); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES($1,$2,1,2,$3)`, chain, hash(120), sourceHash); e != nil {
		t.Fatal(e)
	}
	for _, bh := range []string{creationHash, sourceHash} {
		if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES($1,$2)`, chain, bh); e != nil {
			t.Fatal(e)
		}
	}
	addrWord := func(a string) string { return "0x" + strings.Repeat("0", 24) + a[2:] }
	mint := chainrpc.Log{Address: token, Topics: []string{deployment.Hash([]byte("Transfer(address,address,uint256)")), addrWord(zero), addrWord(curve)}, Data: fmt.Sprintf("0x%064x", 100), BlockNumber: "0x1", BlockHash: creationHash, TransactionHash: hash(130), TransactionIndex: "0x0", LogIndex: "0x0"}
	buy := mint
	buy.Topics = []string{mint.Topics[0], addrWord(curve), addrWord(user)}
	buy.LogIndex = "0x1"
	created := mint
	created.Address = factory
	created.LogIndex = "0x2"
	created.Topics = []string{deployment.Hash([]byte("MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)")), marketID, hash(0), addrWord(token)}
	created.Data = addrWord(curve) + strings.Repeat("0", 128) + strings.Repeat(hash(1)[2:], 3)
	logs := []chainrpc.Log{mint, buy, created}
	putLog := func(index int) {
		data, _ := json.Marshal(logs[index])
		if _, e := pool.Exec(ctx, `INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,$3,$4,$5)`, chain, creationHash, index, logs[index].Address, data); e != nil {
			t.Fatal(e)
		}
	}
	for i := range logs {
		putLog(i)
	}
	receipt := chainrpc.Receipt{TransactionHash: hash(130), TransactionIndex: "0x0", BlockHash: creationHash, BlockNumber: "0x1", Status: "0x1", Logs: logs}
	receiptBytes, _ := json.Marshal(receipt)
	if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,0,'0x1',$4)`, chain, creationHash, receipt.TransactionHash, receiptBytes); e != nil {
		t.Fatal(e)
	}
	discovered := deployment.MarketDiscovery{MarketID: marketID, Source: created, State: map[string]any{"memeToken": token, "quoteAsset": zero, "curve": curve}}
	data, _ := json.Marshal(discovered)
	if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.discovered_markets(chain_id,block_hash,market_id,log_index,payload) VALUES($1,$2,$3,2,$4)`, chain, creationHash, marketID, data); e != nil {
		t.Fatal(e)
	}
	excluded := []string{zero, curve}
	policy, _ := treasury.PolicyHash("4663", marketID, excluded)
	in := treasury.Input{Context: treasury.Context{ChainID: "4663", Distributor: factory, MarketID: marketID, EpochID: 1, MemeToken: token, QuoteToken: zero, EligibilityPolicyHash: policy, WindowStart: "100", WindowEnd: fmt.Sprint(end), SourceBlockNumber: "2", SourceBlockHash: sourceHash}, ExcludedAccounts: excluded, SourceBlockTimestamp: fmt.Sprint(end + 1), QuoteAmount: "1000", Transfers: []treasury.Transfer{}}
	loaded, proof, e := treasury.LoadJournalInput(ctx, pool, in)
	if e != nil || len(loaded.Transfers) != 2 || !proof.JournalRangeChecked || proof.RootRequestVerified || proof.ReceiptRootVerified || proof.InitialMint != "100" {
		t.Fatal("journal load failed", e, proof)
	}
	out, e := treasury.Generate(loaded)
	if e != nil || len(out.Leaves) != 1 || out.Leaves[0].Account != user || out.TotalAllocated != "1000" {
		t.Fatal("journal dataset failed", out, e)
	}
	// Persist a computed candidate with a later finalized request observation.
	requestHash := hash(114)
	if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES($1,3,$2,$3,$4,true)`, chain, requestHash, sourceHash, end+2); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_journal SET finalized_number=3,finalized_hash=$2,tip_number=3,tip_hash=$2 WHERE chain_id=$1`, chain, requestHash); e != nil {
		t.Fatal(e)
	}
	proof.RootRequestVerified = true
	request := deployment.TreasuryRequestSnapshot{ChainID: chain, BlockNumber: "0x3", BlockHash: requestHash, Distributor: in.Distributor, MarketID: marketID, EpochID: 1, EpochDuration: fmt.Sprint(treasury.Duration), TwabSchema: deployment.Hash([]byte("TRANSFER_LOG_TWAB_1H_R6_TEST_ONLY")), SourceTimestamp: in.SourceBlockTimestamp, Market: map[string]any{"memeToken": token, "quoteToken": zero, "eligibilityPolicyHash": policy}, Epoch: map[string]any{"status": "1", "sourceBlockNumber": "2", "sourceBlockHash": sourceHash, "quoteAmount": "1000"}, Window: map[string]any{"start": in.WindowStart, "end": in.WindowEnd}}
	artifact := treasury.Candidate{Input: loaded, Dataset: out, Journal: proof, Request: request}
	id, e := treasury.SaveCandidate(ctx, pool, artifact)
	if e != nil {
		t.Fatal("candidate persistence failed", e)
	}
	again, e := treasury.SaveCandidate(ctx, pool, artifact)
	if e != nil || again != id {
		t.Fatal("candidate idempotency failed", e)
	}
	badArtifact := artifact
	badArtifact.Dataset.MerkleRoot = hash(998)
	if _, e = treasury.SaveCandidate(ctx, pool, badArtifact); e == nil {
		t.Fatal("incorrect computed root persisted")
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.treasury_candidates SET dataset_hash=$2 WHERE id=$1`, id, hash(997)); e != nil {
		t.Fatal(e)
	}
	if _, e = treasury.ReadCandidate(ctx, pool, id); e == nil {
		t.Fatal("corrupt candidate index accepted")
	}
	if _, e = treasury.SaveCandidate(ctx, pool, artifact); e == nil {
		t.Fatal("idempotent write concealed corrupt candidate index")
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.treasury_candidates SET dataset_hash=$2 WHERE id=$1`, id, out.DatasetHash); e != nil {
		t.Fatal(e)
	}
	stored, e := treasury.ReadCandidate(ctx, pool, id)
	if e != nil || stored.Dataset.MerkleRoot != out.MerkleRoot {
		t.Fatal("candidate read failed", e)
	}

	lookup := treasury.CandidateStore{Pool: pool}
	selected, err := lookup.Find(ctx, chain, marketID, 1, out.DatasetHash)
	if err != nil || selected.Dataset.MerkleRoot != out.MerkleRoot {
		t.Fatal("committed dataset lookup failed", err)
	}
	for _, query := range []struct {
		chain   uint64
		market  string
		epoch   uint32
		dataset string
	}{{chain, marketID, 1, hash(995)}, {chain, marketID, 2, out.DatasetHash}, {46630, marketID, 1, out.DatasetHash}, {chain, hash(996), 1, out.DatasetHash}} {
		if _, err := lookup.Find(ctx, query.chain, query.market, query.epoch, query.dataset); !errors.Is(err, treasury.ErrProofNotFound) {
			t.Fatal("candidate query escaped domain", err)
		}
	}
	var original []byte
	if e = pool.QueryRow(ctx, `SELECT payload FROM tickergarden.treasury_candidates WHERE id=$1`, id).Scan(&original); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.treasury_candidates SET payload=payload || decode('20','hex') WHERE id=$1`, id); e != nil {
		t.Fatal(e)
	}
	if _, e = treasury.ReadCandidate(ctx, pool, id); e == nil {
		t.Fatal("candidate corruption accepted")
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.treasury_candidates SET payload=$2 WHERE id=$1`, id, original); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=$1 AND hash=$2`, chain, requestHash); e != nil {
		t.Fatal(e)
	}
	if _, e = treasury.ReadCandidate(ctx, pool, id); e == nil {
		t.Fatal("orphan candidate returned as current")
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=$1 AND hash=$2`, chain, requestHash); e != nil {
		t.Fatal(e)
	}
	testTreasuryJobs(t, ctx, pool, artifact, id)
	testTreasuryRequestDiscovery(t, ctx, pool, artifact)
	// Exercise the user-facing journal command with its own read-only transaction.
	t.Setenv("TG_TREASURY_DATABASE_URL", pool.Config().ConnConfig.ConnString())
	requestPath := filepath.Join(t.TempDir(), "treasury-request.json")
	requestBytes, _ := json.Marshal(in)
	if e = os.WriteFile(requestPath, requestBytes, 0600); e != nil {
		t.Fatal(e)
	}
	var stdout, stderr bytes.Buffer
	if code := treasury.Run([]string{"--journal", "--input", requestPath}, &stdout, &stderr); code != 0 {
		t.Fatal("journal command failed", stderr.String())
	}
	var candidate struct {
		Status                string
		HistoryVerified       bool
		TransactionSubmission bool
		JournalEvidence       treasury.JournalEvidence
		Dataset               treasury.Output
	}
	if e = json.Unmarshal(stdout.Bytes(), &candidate); e != nil || candidate.Status != "candidate_unverified_history" || candidate.HistoryVerified || candidate.TransactionSubmission || !candidate.JournalEvidence.JournalRangeChecked || candidate.Dataset.MerkleRoot != out.MerkleRoot {
		t.Fatal("incorrect journal command evidence", e)
	}
	reject := func() {
		t.Helper()
		got, proof, e := treasury.LoadJournalInput(ctx, pool, in)
		if e == nil || len(got.Transfers) > 0 || proof.JournalRangeChecked {
			t.Fatal("bad source accepted", e)
		}
	}
	// Removed journal log is still visible in the receipt: never silently truncate.
	if _, e = pool.Exec(ctx, `DELETE FROM tickergarden.chain_logs WHERE chain_id=$1 AND block_hash=$2 AND log_index=1`, chain, creationHash); e != nil {
		t.Fatal(e)
	}
	reject()
	putLog(1)
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET block_timestamp=NULL WHERE chain_id=$1 AND number=1`, chain); e != nil {
		t.Fatal(e)
	}
	reject()
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET block_timestamp=100,receipts_verified=false WHERE chain_id=$1 AND number=1`, chain); e != nil {
		t.Fatal(e)
	}
	reject()
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET receipts_verified=true WHERE chain_id=$1 AND number=1`, chain); e != nil {
		t.Fatal(e)
	}
	old := in.SourceBlockHash
	in.SourceBlockHash = hash(999)
	reject()
	in.SourceBlockHash = old
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET parent_hash=$2 WHERE chain_id=$1 AND number=2`, chain, hash(999)); e != nil {
		t.Fatal(e)
	}
	reject()
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_blocks SET parent_hash=$2 WHERE chain_id=$1 AND number=2`, chain, creationHash); e != nil {
		t.Fatal(e)
	}
	// Missing issuance in both sources is still invalid, not an empty epoch.
	if _, e = pool.Exec(ctx, `DELETE FROM tickergarden.chain_logs WHERE chain_id=$1 AND block_hash=$2 AND log_index=0`, chain, creationHash); e != nil {
		t.Fatal(e)
	}
	receipt.Logs = logs[1:]
	withoutMint, _ := json.Marshal(receipt)
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_receipts SET payload=$3 WHERE chain_id=$1 AND block_hash=$2`, chain, creationHash, withoutMint); e != nil {
		t.Fatal(e)
	}
	reject()
	putLog(0)
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.chain_receipts SET payload=$3 WHERE chain_id=$1 AND block_hash=$2`, chain, creationHash, receiptBytes); e != nil {
		t.Fatal(e)
	}
	// Any mismatch between source metadata and discovery's immutable identity fails.
	oldToken := in.MemeToken
	in.MemeToken = user
	reject()
	in.MemeToken = oldToken
	oldTime := in.SourceBlockTimestamp
	in.SourceBlockTimestamp = "1"
	reject()
	in.SourceBlockTimestamp = oldTime
	oldSource := in.SourceBlockNumber
	in.SourceBlockNumber = "3"
	reject()
	in.SourceBlockNumber = oldSource
	// Shared reader respects the writer's exclusive chain lock.
	conn, e := pool.Acquire(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = conn.Exec(ctx, `SELECT pg_advisory_lock(730004663)`); e != nil {
		t.Fatal(e)
	}
	reject()
	if _, e = conn.Exec(ctx, `SELECT pg_advisory_unlock(730004663)`); e != nil {
		t.Fatal(e)
	}
	conn.Release()
	if _, _, e = treasury.LoadJournalInput(ctx, pool, in); e != nil {
		t.Fatal("restored source failed", e)
	}
}
