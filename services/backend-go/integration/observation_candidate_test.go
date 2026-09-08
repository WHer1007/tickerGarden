package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"net/url"
	"os"
	osexec "os/exec"
	"path/filepath"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/projection"
	"tickergarden/backend/internal/projector"
	"tickergarden/backend/internal/readmodel"
	"time"
)

func TestObservationCandidateStore(t *testing.T) {
	if os.Getenv("TG_TEST_OBSERVATION_STORE") != "1" {
		t.Skip("set TG_TEST_OBSERVATION_STORE=1 for isolated observation store")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TG_TEST_DATABASE_URL required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid database URL")
	}
	admin, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal("database unavailable")
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_observation_test_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, e := admin.Exec(cleanup, "DROP DATABASE "+quoted+" WITH (FORCE)"); e != nil {
			t.Error(e)
		}
	}()
	dbCfg := cfg.Copy()
	dbCfg.Database = name
	db := stdlib.OpenDB(*dbCfg)
	defer db.Close()
	migrations, err := migration.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = migrations.Up(ctx); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	pool, err := postgres.Open(ctx, u.String(), 4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	const chain = uint64(46630)

	block, manifest := hash(11), hash(999)
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES($1,$2,1,1,$3,1,$3)`, chain, hash(800), block)
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES($1,1,$2,$3,100,true)`, chain, block, hash(800))
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES($1,$2,1,1,$3)`, chain, manifest, block)
	exec(`INSERT INTO tickergarden.projection_checkpoints(chain_id,manifest_hash,projector_version,start_block,tip_number,tip_hash) VALUES($1,$2,$3,1,1,$4)`, chain, manifest, projector.Version, block)
	batch := deployment.ObservationBatch{Scope: projector.ObservationScope, ChainID: chain, BlockNumber: "0x1", BlockHash: block, Expected: 1, Observations: []deployment.StateObservation{{Kind: "curve", Key: hash(100), Value: map[string]any{"realQuoteReserve": "900719925474099312345"}}}}
	payload, _ := json.Marshal(batch)
	value, _ := json.Marshal(batch.Observations[0].Value)
	exec(`INSERT INTO tickergarden.projection_observation_batches(chain_id,block_hash,scope,expected_count,completed_count,payload,digest) VALUES($1,$2,$3,1,1,$4,$5)`, chain, block, batch.Scope, payload, deployment.Hash(payload))
	exec(`INSERT INTO tickergarden.projection_block_observations(chain_id,block_hash,kind,observation_key,value) VALUES($1,$2,'curve',$3,$4)`, chain, block, hash(100), value)
	store := readmodel.ObservationStore{Pool: pool, ChainID: chain, GenesisHash: hash(800), ManifestHash: manifest, Version: projector.Version, Scope: batch.Scope, StartBlock: 1}
	check := func(valid bool) {
		t.Helper()
		got, e := store.LoadCandidateBatch(ctx)
		if valid {
			if e != nil || len(got.Observations) != 1 || got.Observations[0].Value["realQuoteReserve"] != "900719925474099312345" {
				t.Fatal(got, e)
			}
		} else if e == nil || len(got.Observations) != 0 {
			t.Fatal("invalid batch accepted", got, e)
		}
	}
	check(true)
	for _, tc := range []struct{ name, change, restore string }{
		{"row mismatch", `UPDATE tickergarden.projection_block_observations SET value='{}'`, `UPDATE tickergarden.projection_block_observations SET value=$1`},
		{"stale", `UPDATE tickergarden.chain_journal SET updated_at=now()-interval '121 seconds'`, `UPDATE tickergarden.chain_journal SET updated_at=now()`},
		{"orphan", `UPDATE tickergarden.chain_blocks SET canonical=false`, `UPDATE tickergarden.chain_blocks SET canonical=true`},
		{"receipts", `UPDATE tickergarden.chain_blocks SET receipts_verified=false`, `UPDATE tickergarden.chain_blocks SET receipts_verified=true`},
		{"manifest", `UPDATE tickergarden.discovery_checkpoints SET manifest_hash='` + hash(998) + `'`, `UPDATE tickergarden.discovery_checkpoints SET manifest_hash='` + manifest + `'`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			exec(tc.change)
			check(false)
			if tc.name == "row mismatch" {
				exec(tc.restore, value)
			} else {
				exec(tc.restore)
			}
			check(true)
		})
	}
	exec(`UPDATE tickergarden.projection_observation_batches SET digest=$1`, hash(998))
	check(false)
	exec(`UPDATE tickergarden.projection_observation_batches SET digest=$1`, deployment.Hash(payload))
	check(true)
	// A self-consistent digest must not make duplicate JSON fields acceptable.
	duplicate := append([]byte(`{"scope":"ignored",`), payload[1:]...)
	exec(`UPDATE tickergarden.projection_observation_batches SET payload=$1,digest=$2`, duplicate, deployment.Hash(duplicate))
	check(false)
	exec(`UPDATE tickergarden.projection_observation_batches SET payload=$1,digest=$2`, payload, deployment.Hash(payload))
	check(true)
	store.GenesisHash = hash(801)
	check(false)
	store.GenesisHash = hash(800)
	store.Version = "wrong-version"
	check(false)
	store.Version = projector.Version
	store.StartBlock = 0
	check(false)
	store.StartBlock = 1
	check(true)
	exec(`DELETE FROM tickergarden.projection_block_observations`)
	check(false)
	// An explicitly empty persisted batch is valid when replay also has no inputs.
	empty := batch
	empty.Expected = 0
	empty.Observations = []deployment.StateObservation{}
	emptyPayload, _ := json.Marshal(empty)
	emptyCommit, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{})
	exec(`UPDATE tickergarden.chain_blocks SET receipt_count=0,receipt_set_hash=$1`, emptyCommit)
	exec(`UPDATE tickergarden.projection_observation_batches SET expected_count=0,completed_count=0,payload=$1,digest=$2`, emptyPayload, deployment.Hash(emptyPayload))
	candidate, e := store.LoadCandidateSet(ctx)
	if e != nil || candidate.PublicationEligible || len(candidate.Markets) != 0 || len(candidate.Accounts) != 0 {
		t.Fatal(candidate, e)
	}
	exec(`UPDATE tickergarden.projection_checkpoints SET input_count=1`)
	if candidate, e := store.LoadCandidateSet(ctx); e == nil || len(candidate.Markets) != 0 {
		t.Fatal("missing replay accepted", candidate, e)
	}
	exec(`UPDATE tickergarden.projection_checkpoints SET input_count=0`)
	if _, e := store.LoadCandidateSet(ctx); e != nil {
		t.Fatal("candidate recovery", e)
	}

	// Extend the configured range to genesis: omission and time regression fail.
	store.StartBlock = 0
	exec(`UPDATE tickergarden.projection_checkpoints SET start_block=0`)
	exec(`UPDATE tickergarden.discovery_checkpoints SET start_block=0`)
	if _, e := store.LoadCandidateSet(ctx); e == nil {
		t.Fatal("missing range start accepted")
	}
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified,receipt_count,receipt_set_hash) VALUES($1,0,$2,$3,101,true,0,$4)`, chain, hash(800), hash(0), emptyCommit)
	if _, e := store.LoadCandidateSet(ctx); e == nil {
		t.Fatal("decreasing block time accepted")
	}
	exec(`UPDATE tickergarden.chain_blocks SET block_timestamp=99 WHERE number=0`)
	if _, e := store.LoadCandidateSet(ctx); e != nil {
		t.Fatal("continuous genesis range", e)
	}
	store.StartBlock = 1
	exec(`UPDATE tickergarden.projection_checkpoints SET start_block=1`)
	exec(`UPDATE tickergarden.discovery_checkpoints SET start_block=1`)
	// Replay a real ABI-encoded AssetRegistered fixture, without supplied views.
	golden, e := os.ReadFile("../internal/projection/testdata/golden.json")
	if e != nil {
		t.Fatal(e)
	}
	var cases []struct {
		Input projection.Input `json:"input"`
	}
	if json.Unmarshal(golden, &cases) != nil || len(cases) == 0 {
		t.Fatal("golden input")
	}
	input := cases[0].Input
	input.Observations = nil
	input.Log.BlockNumber = "0x1"
	input.Log.BlockHash = block
	vault := "0x0000000000000000000000000000000000000009"
	input.Log.Topics[3] = hash(9)
	input.Log.Data = "0x0000000000000000000000000000000000000000000000000000000000000012"
	receipt := chainrpc.Receipt{BlockHash: block, BlockNumber: "0x1", TransactionHash: input.Log.TransactionHash, TransactionIndex: "0x0", Status: "0x1", Logs: []chainrpc.Log{input.Log}}
	receiptBytes, _ := json.Marshal(receipt)
	receiptCommit, _ := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
	exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,0,'0x1',$4)`, chain, block, receipt.TransactionHash, receiptBytes)
	exec(`UPDATE tickergarden.chain_blocks SET receipt_count=1,receipt_set_hash=$1`, receiptCommit)
	inputBytes, _ := json.Marshal(input)
	logBytes, _ := json.Marshal(input.Log)
	exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,0,$3,$4)`, chain, block, input.Log.Address, logBytes)
	exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,0,$3,$4)`, chain, block, inputBytes, deployment.Hash(inputBytes))
	exec(`UPDATE tickergarden.projection_checkpoints SET input_count=1`)
	if _, e := store.LoadCandidateSet(ctx); e == nil {
		t.Fatal("omitted replayed asset accepted")
	}
	asset := deployment.StateObservation{Kind: "asset", Key: input.Log.Topics[1], Value: map[string]any{"asset": map[string]any{"status": "1", "stockToken": input.Log.Address, "userStockVault": vault, "tokenDecimals": "18", "minimumAllocation": "414"}, "fingerprint": map[string]any{"tokenRuntimeCodeHash": deployment.Hash([]byte{1}), "beacon": vault, "beaconRuntimeCodeHash": hash(6), "implementation": vault, "implementationRuntimeCodeHash": hash(7)}, "vaultRuntimeCodeHash": deployment.Hash([]byte{1})}}
	populated := empty
	populated.Expected = 2
	solvency := deployment.StateObservation{Kind: "vaultSolvency", Key: asset.Key, Value: map[string]any{"assetUid": asset.Key, "vault": vault, "stockToken": input.Log.Address, "totalDeposited": "0", "totalAllocated": "0", "tokenBalance": "0"}}
	populated.Observations = []deployment.StateObservation{asset, solvency}
	populatedBytes, _ := json.Marshal(populated)
	assetBytes, _ := json.Marshal(asset.Value)
	solvencyBytes, _ := json.Marshal(solvency.Value)
	exec(`INSERT INTO tickergarden.projection_block_observations(chain_id,block_hash,kind,observation_key,value) VALUES($1,$2,'vaultSolvency',$3,$4)`, chain, block, asset.Key, solvencyBytes)
	exec(`UPDATE tickergarden.projection_observation_batches SET expected_count=2,completed_count=2,payload=$1,digest=$2`, populatedBytes, deployment.Hash(populatedBytes))
	exec(`INSERT INTO tickergarden.projection_block_observations(chain_id,block_hash,kind,observation_key,value) VALUES($1,$2,'asset',$3,$4)`, chain, block, asset.Key, assetBytes)
	candidate, e = store.LoadCandidateSet(ctx)
	if e != nil || len(candidate.Configs) != 1 || candidate.Configs[0].Source.TransactionHash != input.Log.TransactionHash || candidate.Configs[0].Values["minimumAllocation"] != "414" {
		t.Fatal(candidate, e)
	}
	exec(`UPDATE tickergarden.chain_blocks SET parent_hash=$1`, hash(801))
	if _, e := store.LoadCandidateSet(ctx); e == nil {
		t.Fatal("genesis parent mismatch accepted")
	}
	exec(`UPDATE tickergarden.chain_blocks SET parent_hash=$1`, hash(800))
	exec(`DELETE FROM tickergarden.chain_receipts`)
	if _, e := store.LoadCandidateSet(ctx); e == nil {
		t.Fatal("omitted receipt accepted")
	}
	exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,0,'0x1',$4)`, chain, block, receipt.TransactionHash, receiptBytes)
	exec(`UPDATE tickergarden.chain_blocks SET receipt_set_hash=$1`, emptyCommit)
	if _, e := store.LoadCandidateSet(ctx); e == nil {
		t.Fatal("receipt commitment mismatch accepted")
	}
	exec(`UPDATE tickergarden.chain_blocks SET receipt_set_hash=$1`, receiptCommit)
	if _, e := store.LoadCandidateSet(ctx); e != nil {
		t.Fatal("receipt recovery", e)
	}
	var runCLI func() ([]byte, []byte, error)
	if os.Getenv("TG_TEST_CANDIDATE_CLI") == "1" {
		contracts, responses, codes := candidateAssetFixture(input.Log.Address, input.Log.Address, vault, asset.Key)
		configured := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: chain, GenesisHash: hash(800), Contracts: contracts}
		manifestBytes, _ := json.Marshal(configured)
		path := filepath.Join(t.TempDir(), "manifest.json")
		if e := os.WriteFile(path, manifestBytes, 0600); e != nil {
			t.Fatal(e)
		}
		scopeHash := deployment.Hash(manifestBytes)
		exec(`UPDATE tickergarden.projection_checkpoints SET manifest_hash=$1`, scopeHash)
		exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1`, scopeHash)
		store.ManifestHash = scopeHash
		server, rpcMode, rpcCalls := candidateRPCFixture(t, chain, hash(800), block, input.Log.Address, responses, codes)
		verifyRPC := false
		verifyAssets := false
		runCLI = func() ([]byte, []byte, error) {
			command := osexec.CommandContext(ctx, "go", "run", "-race", "./cmd/candidate-inspect", "--once")
			if verifyAssets {
				command.Args = append(command.Args, "--verify-assets-rpc")
			} else if verifyRPC {
				command.Args = append(command.Args, "--verify-static-rpc")
			}
			command.Dir = ".."
			command.Env = append(os.Environ(), "TG_CANDIDATE_DATABASE_URL="+u.String(), "TG_DEPLOYMENT_MANIFEST="+path, "TG_PROJECTION_START_BLOCK=1", "TG_CANDIDATE_RPC_URL="+server.URL)
			var stdout, stderr bytes.Buffer
			command.Stdout = &stdout
			command.Stderr = &stderr
			e := command.Run()
			return stdout.Bytes(), stderr.Bytes(), e
		}
		out, stderr, e := runCLI()
		if e != nil {
			t.Fatalf("candidate CLI failed: %v %s", e, stderr)
		}
		var result struct {
			ReadOnly    bool                   `json:"readOnly"`
			Independent bool                   `json:"independentEmitterAuthentication"`
			Candidate   readmodel.CandidateSet `json:"candidate"`
		}
		if json.Unmarshal(out, &result) != nil || !result.ReadOnly || result.Independent || !result.Candidate.ProtocolEventInventoryVerified || !result.Candidate.EmitterAddressBindingsVerified || result.Candidate.PublicationEligible || len(result.Candidate.Configs) != 1 {
			t.Fatal("invalid candidate CLI output", string(out))
		}

		if rpcCalls.Load() != 0 {
			t.Fatal("local mode contacted RPC")
		}
		verifyRPC = true
		for _, mode := range []int32{0, 1, 2, 0} {
			rpcMode.Store(mode)
			before := rpcCalls.Load()
			out, stderr, e := runCLI()
			if rpcCalls.Load() <= before {
				t.Fatal("RPC option made no requests")
			}
			if mode != 0 {
				if e == nil || len(out) != 0 {
					t.Fatal("RPC failure emitted candidate", string(out))
				}
				continue
			}
			if e != nil {
				t.Fatalf("static RPC CLI: %v %s", e, stderr)
			}
			var proof struct {
				Static      bool                   `json:"staticRuntimeAtCandidateVerified"`
				Independent bool                   `json:"independentEmitterAuthentication"`
				Candidate   readmodel.CandidateSet `json:"candidate"`
			}
			if json.Unmarshal(out, &proof) != nil || !proof.Static || proof.Independent || proof.Candidate.PublicationEligible || len(proof.Candidate.Configs) != 1 {
				t.Fatal("invalid RPC proof", string(out))
			}
		}

		verifyAssets = true
		for _, mode := range []int32{0, 3, 4, 5, 0} {
			rpcMode.Store(mode)
			out, stderr, e := runCLI()
			if mode != 0 {
				if e == nil || len(out) != 0 {
					t.Fatal("asset mismatch emitted candidate", string(out))
				}
				continue
			}
			if e != nil {
				t.Fatalf("asset RPC CLI: %v %s", e, stderr)
			}
			var proof struct {
				Asset     bool                   `json:"assetIdentitiesAtCandidateVerified"`
				Static    bool                   `json:"staticRuntimeAtCandidateVerified"`
				Candidate readmodel.CandidateSet `json:"candidate"`
			}
			if json.Unmarshal(out, &proof) != nil || !proof.Asset || !proof.Static || proof.Candidate.PublicationEligible {
				t.Fatal("invalid asset RPC proof", string(out))
			}
		}
		verifyAssets = false
		verifyRPC = false

		// Remove both the input and its derived observations, and forge matching
		// counters. Complete receipts must still reveal the omitted event.
		exec(`DELETE FROM tickergarden.projection_inputs`)
		exec(`UPDATE tickergarden.projection_checkpoints SET input_count=0`)
		exec(`DELETE FROM tickergarden.projection_block_observations`)
		emptyBytes, _ := json.Marshal(empty)
		exec(`UPDATE tickergarden.projection_observation_batches SET expected_count=0,completed_count=0,payload=$1,digest=$2`, emptyBytes, deployment.Hash(emptyBytes))
		out, _, e = runCLI()
		if e == nil || len(out) != 0 {
			t.Fatal("omitted protocol input accepted", string(out))
		}
		exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,0,$3,$4)`, chain, block, inputBytes, deployment.Hash(inputBytes))
		exec(`UPDATE tickergarden.projection_checkpoints SET input_count=1`)
		exec(`INSERT INTO tickergarden.projection_block_observations(chain_id,block_hash,kind,observation_key,value) VALUES($1,$2,'asset',$3,$4)`, chain, block, asset.Key, assetBytes)
		exec(`INSERT INTO tickergarden.projection_block_observations(chain_id,block_hash,kind,observation_key,value) VALUES($1,$2,'vaultSolvency',$3,$4)`, chain, block, asset.Key, solvencyBytes)
		exec(`UPDATE tickergarden.projection_observation_batches SET expected_count=2,completed_count=2,payload=$1,digest=$2`, populatedBytes, deployment.Hash(populatedBytes))
		if _, stderr, e := runCLI(); e != nil {
			t.Fatalf("inventory recovery: %v %s", e, stderr)
		}
	}
	exec(`UPDATE tickergarden.chain_logs SET payload=jsonb_set(payload,'{data}','"0x"'::jsonb)`)
	if _, e := store.LoadCandidateSet(ctx); e == nil {
		t.Fatal("altered raw log accepted")
	}

	if runCLI != nil {
		out, _, e := runCLI()
		if e == nil || len(out) != 0 {
			t.Fatal("CLI emitted invalid candidate", string(out), e)
		}
	}

}
