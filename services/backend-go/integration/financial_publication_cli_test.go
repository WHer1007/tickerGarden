package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	osexec "os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/projector"
	"tickergarden/backend/internal/readmodel"
)

func publicationRPCServer(t *testing.T, chain uint64, genesis string, header *types.Header, responses map[string]string, codes map[string]bool) (*httptest.Server, *atomic.Bool) {
	t.Helper()
	blockHash := strings.ToLower(header.Hash().Hex())
	raw, err := json.Marshal(header)
	if err != nil {
		t.Fatal(err)
	}
	var full map[string]any
	if json.Unmarshal(raw, &full) != nil {
		t.Fatal("cannot encode controlled header")
	}
	full["hash"] = blockHash
	full["transactions"] = []string{}
	wrong := new(atomic.Bool)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ID     json.RawMessage   `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		var result any
		switch request.Method {
		case "eth_chainId":
			result = fmt.Sprintf("0x%x", chain)
		case "eth_getBlockByNumber":
			var tag string
			if len(request.Params) != 2 || json.Unmarshal(request.Params[0], &tag) != nil {
				t.Error("invalid block-number request")
				http.Error(w, "invalid", http.StatusBadRequest)
				return
			}
			if tag == "0x0" {
				result = chainrpc.Header{Number: "0x0", Hash: genesis, ParentHash: "0x" + strings.Repeat("0", 64), Timestamp: "0x0"}
			} else if tag == "0x1" || tag == "finalized" {
				copy := make(map[string]any, len(full))
				for key, value := range full {
					copy[key] = value
				}
				if wrong.Load() {
					copy["hash"] = "0x" + strings.Repeat("f", 64)
				}
				result = copy
			} else {
				t.Errorf("unexpected block tag %s", tag)
				http.Error(w, "unknown block", http.StatusBadRequest)
				return
			}
		case "eth_getBlockByHash":
			var requested string
			if len(request.Params) != 2 || json.Unmarshal(request.Params[0], &requested) != nil || requested != blockHash {
				t.Error("invalid block-hash request")
				http.Error(w, "invalid", http.StatusBadRequest)
				return
			}
			result = full
		case "eth_getCode":
			var target string
			var selector struct {
				Hash      string `json:"blockHash"`
				Canonical bool   `json:"requireCanonical"`
			}
			if len(request.Params) != 2 || json.Unmarshal(request.Params[0], &target) != nil || json.Unmarshal(request.Params[1], &selector) != nil || !selector.Canonical || !codes[target] {
				t.Error("unscoped code request")
				http.Error(w, "invalid", http.StatusBadRequest)
				return
			}
			switch selector.Hash {
			case genesis:
				result = "0x"
			case blockHash:
				result = "0x01"
			default:
				t.Errorf("unexpected code block %s", selector.Hash)
				http.Error(w, "unknown block", http.StatusBadRequest)
				return
			}
		case "eth_call":
			var target struct {
				To   string `json:"to"`
				Data string `json:"data"`
			}
			var selector struct {
				Hash      string `json:"blockHash"`
				Canonical bool   `json:"requireCanonical"`
			}
			if len(request.Params) != 2 || json.Unmarshal(request.Params[0], &target) != nil || json.Unmarshal(request.Params[1], &selector) != nil || selector.Hash != blockHash || !selector.Canonical {
				t.Error("unscoped call")
				http.Error(w, "invalid", http.StatusBadRequest)
				return
			}
			value, ok := responses[target.To+":"+target.Data]
			if !ok {
				t.Errorf("unexpected call %s %s", target.To, target.Data)
				http.Error(w, "unknown call", http.StatusBadRequest)
				return
			}
			result = value
		default:
			t.Errorf("unexpected publication RPC method %s", request.Method)
			http.Error(w, "unsupported", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result})
	}))
	t.Cleanup(server.Close)
	return server, wrong
}

func TestFinancialPublicationCLIRejectsZeroMarketEvidence(t *testing.T) {
	if os.Getenv("TG_TEST_FINANCIAL_PUBLICATION_CLI") != "1" {
		t.Skip("set TG_TEST_FINANCIAL_PUBLICATION_CLI=1")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TG_TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_financial_cli_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, dropErr := admin.Exec(cleanup, "DROP DATABASE "+quoted+" WITH (FORCE)"); dropErr != nil {
			t.Error(dropErr)
		}
	}()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	dbConfig, err := pgx.ParseConfig(u.String())
	if err != nil {
		t.Fatal(err)
	}
	db := stdlib.OpenDB(*dbConfig)
	defer db.Close()
	migrations, err := migration.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = migrations.Up(ctx); err != nil {
		t.Fatal(err)
	}
	pool, err := postgres.Open(ctx, u.String(), 4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	chain := uint64(46630)
	genesis := "0x" + strings.Repeat("1", 64)
	header := &types.Header{
		ParentHash:  common.HexToHash(genesis),
		UncleHash:   types.EmptyUncleHash,
		Root:        common.HexToHash("0x" + strings.Repeat("2", 64)),
		TxHash:      types.EmptyTxsHash,
		ReceiptHash: types.EmptyReceiptsHash,
		Difficulty:  big.NewInt(0),
		Number:      big.NewInt(1),
		GasLimit:    30_000_000,
		Time:        100,
		Extra:       []byte{},
		MixDigest:   common.HexToHash("0x" + strings.Repeat("3", 64)),
		BaseFee:     big.NewInt(1),
	}
	blockHash := strings.ToLower(header.Hash().Hex())
	emptyCommitment, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{})
	if err != nil {
		t.Fatal(err)
	}
	registry := "0x" + strings.Repeat("4", 40)
	token := "0x" + strings.Repeat("5", 40)
	vault := "0x" + strings.Repeat("6", 40)
	contracts, responses, codes := candidateAssetFixture(registry, token, vault, "0x"+strings.Repeat("7", 64))
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: chain, GenesisHash: genesis, Contracts: contracts}
	manifestRaw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = deployment.Parse(manifestRaw); err != nil {
		t.Fatal("controlled manifest invalid", err)
	}
	manifestHash := deployment.Hash(manifestRaw)
	batch := deployment.ObservationBatch{Scope: projector.ObservationScope, ChainID: chain, BlockNumber: "0x1", BlockHash: blockHash, Expected: 0, Observations: []deployment.StateObservation{}}
	batchRaw, err := json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, execErr := pool.Exec(ctx, query, args...); execErr != nil {
			t.Fatal(execErr)
		}
	}
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES($1,$2,1,1,$3,1,$3)`, chain, genesis, blockHash)
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,canonical,receipts_verified,receipt_count,receipt_set_hash,receipts_root,root_receipt_set_hash) VALUES($1,1,$2,$3,100,true,true,0,$4,$5,$4)`, chain, blockHash, genesis, emptyCommitment, strings.ToLower(types.EmptyReceiptsHash.Hex()))
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES($1,$2,1,1,$3)`, chain, manifestHash, blockHash)
	exec(`INSERT INTO tickergarden.projection_checkpoints(chain_id,manifest_hash,projector_version,start_block,tip_number,tip_hash,input_count) VALUES($1,$2,$3,1,1,$4,0)`, chain, manifestHash, projector.Version, blockHash)
	exec(`INSERT INTO tickergarden.projection_observation_batches(chain_id,block_hash,scope,expected_count,completed_count,payload,digest) VALUES($1,$2,$3,0,0,$4,$5)`, chain, blockHash, projector.ObservationScope, batchRaw, deployment.Hash(batchRaw))
	store := readmodel.ObservationStore{EmitterManifest: &manifest, Pool: pool, ChainID: chain, GenesisHash: genesis, ManifestHash: manifestHash, Version: projector.Version, Scope: projector.ObservationScope, StartBlock: 1}
	candidate, err := store.LoadCandidateSet(ctx)
	if err != nil {
		t.Fatal("controlled candidate unavailable", err)
	}
	if candidate.FeeReconciliation == nil || candidate.FeeReconciliation.Status != "mismatch" || candidate.FeeReconciliation.Report == nil || candidate.FeeReconciliation.Report.Expected != 0 || candidate.FeeReconciliation.Report.MatchesKnownLiabilities || !candidate.HistoryReceiptRootsVerified || !candidate.TreasuryClaimHistoryVerified || !candidate.ServiceCreditHistoryVerified || !candidate.ProtocolEventInventoryVerified || !candidate.EmitterAddressBindingsVerified {
		raw, _ := json.Marshal(candidate)
		t.Fatalf("controlled zero-market candidate does not express missing financial evidence: %s", raw)
	}

	primary, _ := publicationRPCServer(t, chain, genesis, header, responses, codes)
	independent, independentWrong := publicationRPCServer(t, chain, genesis, header, responses, codes)
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, "manifest.json")
	if err = os.WriteFile(manifestPath, manifestRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	run := func(independentURL string) ([]byte, []byte, error) {
		command := osexec.CommandContext(ctx, "go", "run", "-race", "./cmd/candidate-inspect", "--publish")
		command.Dir = ".."
		command.Env = append(os.Environ(),
			"TG_CANDIDATE_DATABASE_URL="+u.String(),
			"TG_PUBLISHER_DATABASE_URL="+u.String(),
			"TG_DEPLOYMENT_MANIFEST="+manifestPath,
			"TG_PROJECTION_START_BLOCK=1",
			"TG_CANDIDATE_RPC_URL="+primary.URL,
			"TG_CANDIDATE_INDEPENDENT_RPC_URL="+independentURL,
		)
		var stdout, stderr bytes.Buffer
		command.Stdout = &stdout
		command.Stderr = &stderr
		err := command.Run()
		return stdout.Bytes(), stderr.Bytes(), err
	}
	out, _, runErr := run(independent.URL)
	if runErr == nil || len(out) != 0 {
		t.Fatal("zero-market candidate published without liability probes")
	}
	var snapshots, evidence int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.read_snapshots`).Scan(&snapshots); err != nil || snapshots != 0 {
		t.Fatal("rejected zero-market candidate changed snapshots", snapshots, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.read_snapshot_evidence`).Scan(&evidence); err != nil || evidence != 0 {
		t.Fatal("rejected zero-market candidate changed publication evidence", evidence, err)
	}

	independentWrong.Store(true)
	out, _, runErr = run(independent.URL)
	if runErr == nil || len(out) != 0 {
		t.Fatal("independent RPC block mismatch published output")
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.read_snapshots`).Scan(&snapshots); err != nil || snapshots != 0 {
		t.Fatal("failed independent verification changed publication", snapshots, err)
	}
	out, _, runErr = run(primary.URL)
	if runErr == nil || len(out) != 0 {
		t.Fatal("identical primary and independent endpoint accepted")
	}
}
