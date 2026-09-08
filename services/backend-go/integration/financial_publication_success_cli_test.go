package integration

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	osexec "os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/projection"
	"tickergarden/backend/internal/projector"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/testfixture/readmodelpublication"
)

func clonePublicationBatch(t *testing.T, source deployment.ObservationBatch) deployment.ObservationBatch {
	t.Helper()
	raw, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	var result deployment.ObservationBatch
	if json.Unmarshal(raw, &result) != nil {
		t.Fatal("cannot clone publication batch")
	}
	return result
}

func publicationObservation(t *testing.T, batch *deployment.ObservationBatch, kind, key string) map[string]any {
	t.Helper()
	for i := range batch.Observations {
		if batch.Observations[i].Kind == kind && batch.Observations[i].Key == key {
			return batch.Observations[i].Value
		}
	}
	t.Fatalf("missing publication observation %s:%s", kind, key)
	return nil
}

func publicationWord(value string) string {
	value = strings.TrimPrefix(value, "0x")
	return strings.Repeat("0", 64-len(value)) + value
}

func publicationNumber(value string) string {
	n, ok := new(big.Int).SetString(value, 10)
	if !ok {
		panic("invalid publication number " + value)
	}
	return fmt.Sprintf("%064x", n)
}

func publicationTemplateHash(values map[string]any) string {
	raw, _ := hex.DecodeString(deployment.Hash([]byte("TICKERGARDEN_V1_LAUNCH_TEMPLATE"))[2:])
	raw = append(raw, make([]byte, 31)...)
	raw = append(raw, 2)
	for _, field := range []string{"memeTokenImplementation", "memeTokenCodeHash", "curveImplementation", "curveCodeHash", "gaugeImplementation", "gaugeCodeHash", "graduatedHook", "hookCodeHash", "graduationExecutor", "graduationExecutorCodeHash", "feePolicyId", "executionSpecId"} {
		word, _ := hex.DecodeString(publicationWord(values[field].(string)))
		raw = append(raw, word...)
	}
	return deployment.Hash(raw)
}

func preparePublicationBatch(t *testing.T, f readmodelpublication.Fixture, feeVault string) deployment.ObservationBatch {
	t.Helper()
	batch := clonePublicationBatch(t, f.FullObservationBatch)
	batch.Scope = projector.ObservationScope
	codeHash := deployment.Hash([]byte{1})
	executionSpec := deployment.Hash([]byte("V1-EXEC-11"))
	hook := "0x0000000000000000000000000000000000002044"
	market := publicationObservation(t, &batch, "market", f.MarketID)
	template := publicationObservation(t, &batch, "template", f.TemplateID)
	asset := publicationObservation(t, &batch, "asset", f.AssetUID)
	quote := publicationObservation(t, &batch, "quote", f.QuoteConfigID)
	market["executionSpecId"] = executionSpec
	market["expectedEconomics"] = quote["economicsHash"]
	market["graduatedHook"] = hook
	template["executionSpecId"] = executionSpec
	template["graduatedHook"] = hook
	for _, field := range []string{"memeTokenCodeHash", "curveCodeHash", "gaugeCodeHash", "hookCodeHash", "graduationExecutorCodeHash"} {
		template[field] = codeHash
	}
	template["templateHash"] = publicationTemplateHash(template)
	template["componentCodeIdentityCurrent"] = true
	publicationObservation(t, &batch, "canonicalRoute", f.MarketID)["hook"] = hook
	for _, field := range []string{"swapRouter", "quoter", "graduationExecutor"} {
		publicationObservation(t, &batch, "routeRuntime", f.MarketID)[field] = codeHash
	}
	fingerprint := asset["fingerprint"].(map[string]any)
	fingerprint["tokenRuntimeCodeHash"] = codeHash
	fingerprint["beaconRuntimeCodeHash"] = "0x" + strings.Repeat("0", 63) + "6"
	fingerprint["implementationRuntimeCodeHash"] = "0x" + strings.Repeat("0", 63) + "7"
	asset["vaultRuntimeCodeHash"] = codeHash
	for i := range batch.Observations {
		if batch.Observations[i].Kind == "feeLiability" || batch.Observations[i].Kind == "feeSolvency" {
			batch.Observations[i].Value["feeVault"] = feeVault
		}
	}
	epoch := publicationObservation(t, &batch, "creatorEpoch", f.MarketID+":1")
	epoch["observedAtTimestamp"] = "1"
	epoch["rawRewardExitReady"] = false
	batch.Expected = len(batch.Observations)
	return batch
}

func preparePublicationInputs(t *testing.T, f readmodelpublication.Fixture, batch deployment.ObservationBatch, roots map[string]string) []projection.Input {
	t.Helper()
	market := publicationObservation(t, &batch, "market", f.MarketID)
	assetEnvelope := publicationObservation(t, &batch, "asset", f.AssetUID)
	asset := assetEnvelope["asset"].(map[string]any)
	quote := publicationObservation(t, &batch, "quote", f.QuoteConfigID)
	baseline := publicationObservation(t, &batch, "baseline", f.BaselineID)
	template := publicationObservation(t, &batch, "template", f.TemplateID)
	byModule := map[string]projection.Input{}
	for _, input := range f.RawInputs {
		input.Observations = nil
		byModule[input.Module] = input
	}
	inputs := []projection.Input{}
	add := func(module string, topics []string, data string) {
		input := byModule[module]
		input.Module = module
		input.Log.Address = roots[module]
		input.Log.Topics = append([]string{input.Log.Topics[0]}, topics...)
		input.Log.Data = "0x" + data
		input.Log.LogIndex = fmt.Sprintf("0x%x", len(inputs))
		input.Log.TransactionIndex = "0x0"
		input.Log.Removed = false
		inputs = append(inputs, input)
	}
	topic := func(value string) string { return "0x" + publicationWord(value) }
	add("OfficialStockRegistryV1", []string{topic(f.AssetUID), topic(asset["stockToken"].(string)), topic(asset["userStockVault"].(string))}, publicationNumber(asset["tokenDecimals"].(string)))
	add("ApprovedQuoteRegistry", []string{topic(f.QuoteConfigID), topic(f.QuoteAsset), topic(f.BaselineID)}, publicationWord(quote["economicsHash"].(string)))
	add("TickerGardenBaselineRegistry", []string{topic(f.BaselineID), topic(baseline["behaviorVectorRoot"].(string))}, publicationWord(baseline["referenceFactoryCodeHash"].(string)))
	add("LaunchTemplateRegistry", []string{topic(f.TemplateID), topic(template["templateHash"].(string)), topic(template["executionSpecId"].(string))}, "")
	add("TickerGardenFactoryV1", []string{f.MarketID, topic(f.AssetUID), topic(f.MemeToken)}, publicationWord(f.Curve)+publicationWord(f.Gauge)+publicationWord(f.QuoteAsset)+publicationWord(f.BaselineID)+publicationWord(f.QuoteConfigID)+publicationWord(market["expectedEconomics"].(string)))
	inputs[len(inputs)-1].Observations = []projection.Observation{{Kind: "market", Key: f.MarketID, Value: projection.Row(market)}}
	fee := byModule["ProtocolFeeVault"]
	fee.Module = "ProtocolFeeVault"
	fee.Log.Address = roots["ProtocolFeeVault"]
	fee.Log.Topics = []string{fee.Log.Topics[0], f.MarketID, topic("1"), topic(f.QuoteAsset)}
	fee.Log.Data = "0x" + publicationWord(f.TemplateID) + publicationNumber("1") + publicationNumber("0") + publicationNumber("0") + publicationNumber("0")
	fee.Log.LogIndex = fmt.Sprintf("0x%x", len(inputs))
	fee.Log.TransactionIndex = "0x0"
	fee.Log.Removed = false
	fee.Observations = nil
	inputs = append(inputs, fee)
	return inputs
}

func publicationSuccessRPCServer(t *testing.T, manifest deployment.Manifest, parent chainrpc.Header, receipt financialReceiptFixture, responses map[string]string, codes map[string]bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var q struct {
			ID     json.RawMessage   `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		if json.NewDecoder(r.Body).Decode(&q) != nil {
			http.Error(w, "invalid", http.StatusBadRequest)
			return
		}
		var result any
		switch q.Method {
		case "eth_chainId":
			result = fmt.Sprintf("0x%x", manifest.ChainID)
		case "eth_getBlockByNumber":
			var tag string
			_ = json.Unmarshal(q.Params[0], &tag)
			switch tag {
			case "0x0":
				result = chainrpc.Header{Number: "0x0", Hash: manifest.GenesisHash, ParentHash: "0x" + strings.Repeat("0", 64), Timestamp: "0x0"}
			case parent.Number:
				result = parent
			case receipt.Header.Number, "finalized":
				result = json.RawMessage(receipt.RawHeader)
			default:
				http.Error(w, "unknown block", http.StatusBadRequest)
				return
			}
		case "eth_getBlockByHash":
			result = json.RawMessage(receipt.RawHeader)
		case "eth_getTransactionReceipt":
			result = json.RawMessage(receipt.RawReceipt)
		case "eth_getCode":
			var address string
			var selector struct {
				BlockHash string `json:"blockHash"`
			}
			_ = json.Unmarshal(q.Params[0], &address)
			_ = json.Unmarshal(q.Params[1], &selector)
			if selector.BlockHash == parent.Hash {
				result = "0x"
			} else if selector.BlockHash == receipt.Header.Hash && codes[strings.ToLower(address)] {
				result = "0x01"
			} else {
				http.Error(w, "unknown code", http.StatusBadRequest)
				return
			}
		case "eth_call":
			var call struct{ To, Data string }
			_ = json.Unmarshal(q.Params[0], &call)
			value, ok := responses[strings.ToLower(call.To)+":"+strings.ToLower(call.Data)]
			if !ok {
				t.Logf("missing publication RPC call to=%s data=%s", call.To, call.Data)
				http.Error(w, "unknown call "+call.Data, http.StatusBadRequest)
				return
			}
			result = value
		default:
			http.Error(w, "unsupported", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "result": result})
	}))
}

func TestFinancialPublicationCLIPublishesNonEmptyCandidate(t *testing.T) {
	if os.Getenv("TG_TEST_FINANCIAL_PUBLICATION_CLI") != "1" {
		t.Skip("set TG_TEST_FINANCIAL_PUBLICATION_CLI=1")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TG_TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	defer cancel()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_financial_success_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		_, _ = admin.Exec(cleanup, "DROP DATABASE "+quoted+" WITH (FORCE)")
	}()
	u, _ := url.Parse(dsn)
	u.Path = "/" + name
	dbConfig, _ := pgx.ParseConfig(u.String())
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
	exec := func(query string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, query, args...); e != nil {
			t.Fatal(e)
		}
	}

	f, err := readmodelpublication.Load()
	if err != nil {
		t.Fatal(err)
	}
	genesis := "0x" + strings.Repeat("a", 64)
	registry, vault := "0x"+strings.Repeat("7", 40), "0x"+strings.Repeat("0", 39)+"8"
	contracts, responses, codes := candidateAssetFixture(registry, f.MemeToken, vault, f.AssetUID)
	creator := "0x" + strings.Repeat("9", 40)
	contracts = append(contracts, deployment.Contract{Module: "CreatorRevenueRegistry", Address: creator, RuntimeCodeHash: deployment.Hash([]byte{1})})
	sort.Slice(contracts, func(i, j int) bool { return contracts[i].Address < contracts[j].Address })
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: f.ChainID, GenesisHash: genesis, Contracts: contracts}
	roots := map[string]string{}
	for _, contract := range contracts {
		roots[contract.Module] = contract.Address
	}
	batch := preparePublicationBatch(t, f, roots["ProtocolFeeVault"])
	inputs := preparePublicationInputs(t, f, batch, roots)
	parent := chainrpc.Header{Number: "0x9", Hash: "0x" + strings.Repeat("b", 64), ParentHash: genesis, Timestamp: "0x0"}
	receipt, err := makeFinancialPublicationReceiptFixture(f.ChainID, 10, parent.Hash, f.TransactionHash, inputs)
	if err != nil {
		t.Fatal(err)
	}
	batch.BlockHash = strings.ToLower(receipt.Header.Hash)
	for i := range inputs {
		inputs[i].Log = receipt.Logs[i]
		if len(inputs[i].Observations) == 1 {
			inputs[i].Observations[0].Value = projection.Row(publicationObservation(t, &batch, "market", f.MarketID))
		}
	}
	manifestRaw, _ := json.Marshal(manifest)
	if _, err = deployment.Parse(manifestRaw); err != nil {
		t.Fatal("controlled manifest invalid", err)
	}
	manifestHash := deployment.Hash(manifestRaw)
	commitment, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt.Receipt})
	if err != nil {
		t.Fatal(err)
	}
	batchRaw, _ := json.Marshal(batch)
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES($1,$2,10,10,$3,10,$3)`, f.ChainID, genesis, receipt.Header.Hash)
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,canonical,receipts_verified,receipt_count,receipt_set_hash,receipts_root,root_receipt_set_hash) VALUES($1,10,$2,$3,1,true,true,1,$4,$5,$4)`, f.ChainID, receipt.Header.Hash, parent.Hash, commitment, receipt.ReceiptRoot)
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES($1,$2,10,10,$3)`, f.ChainID, manifestHash, receipt.Header.Hash)
	exec(`INSERT INTO tickergarden.projection_checkpoints(chain_id,manifest_hash,projector_version,start_block,tip_number,tip_hash,input_count) VALUES($1,$2,$3,10,10,$4,$5)`, f.ChainID, manifestHash, projector.Version, receipt.Header.Hash, len(inputs))
	receiptRaw, _ := json.Marshal(receipt.Receipt)
	exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,0,'0x1',$4)`, f.ChainID, receipt.Header.Hash, receipt.Receipt.TransactionHash, receiptRaw)
	for i, input := range inputs {
		inputRaw, _ := json.Marshal(input)
		logRaw, _ := json.Marshal(input.Log)
		exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,$3,$4,$5)`, f.ChainID, receipt.Header.Hash, i, input.Log.Address, logRaw)
		exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,$3,$4,$5)`, f.ChainID, receipt.Header.Hash, i, inputRaw, deployment.Hash(inputRaw))
	}
	exec(`INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES($1,$2)`, f.ChainID, receipt.Header.Hash)
	discovery := deployment.MarketDiscovery{MarketID: f.MarketID, Source: inputs[4].Log, State: publicationObservation(t, &batch, "market", f.MarketID)}
	discoveryRaw, _ := json.Marshal(discovery)
	exec(`INSERT INTO tickergarden.discovered_markets(chain_id,block_hash,market_id,log_index,payload) VALUES($1,$2,$3,4,$4)`, f.ChainID, receipt.Header.Hash, f.MarketID, discoveryRaw)
	exec(`INSERT INTO tickergarden.projection_observation_batches(chain_id,block_hash,scope,expected_count,completed_count,payload,digest) VALUES($1,$2,$3,$4,$4,$5,$6)`, f.ChainID, receipt.Header.Hash, projector.ObservationScope, batch.Expected, batchRaw, deployment.Hash(batchRaw))
	for _, observation := range batch.Observations {
		value, _ := json.Marshal(observation.Value)
		exec(`INSERT INTO tickergarden.projection_block_observations(chain_id,block_hash,kind,observation_key,value) VALUES($1,$2,$3,$4,$5)`, f.ChainID, receipt.Header.Hash, observation.Kind, observation.Key, value)
	}
	store := readmodel.ObservationStore{EmitterManifest: &manifest, Pool: pool, ChainID: f.ChainID, GenesisHash: genesis, ManifestHash: manifestHash, Version: projector.Version, Scope: projector.ObservationScope, StartBlock: 10}
	candidate, err := store.LoadCandidateSet(ctx)
	if err != nil {
		t.Fatal("controlled nonempty candidate unavailable", err)
	}
	if len(candidate.Markets) != 1 || candidate.FeeReconciliation == nil || candidate.FeeReconciliation.Status != "matched" {
		t.Fatalf("controlled candidate incomplete: %+v", candidate)
	}
	if readmodel.VerifyCreatorEpochEvidence(candidate) != nil {
		t.Fatal("controlled creator evidence is not publication eligible")
	}
	augmentFinancialPublicationRPCResponses(manifest, candidate, responses, codes)
	primary := publicationSuccessRPCServer(t, manifest, parent, receipt, responses, codes)
	defer primary.Close()
	secondary := publicationSuccessRPCServer(t, manifest, parent, receipt, responses, codes)
	defer secondary.Close()
	rpcClient, err := chainrpc.New(primary.URL)
	if err != nil {
		t.Fatal(err)
	}
	for _, config := range candidate.Configs {
		if config.Kind == "asset" {
			continue
		}
		observed, observeErr := deployment.ObserveConfigBlock(ctx, rpcClient, manifest, receipt.Header, []deployment.ConfigTarget{{Kind: config.Kind, ID: config.ID}})
		if observeErr != nil {
			t.Fatalf("controlled %s config RPC failed: %v", config.Kind, observeErr)
		}
		got, buildErr := readmodel.BuildConfigCandidate(observed, config.Kind, config.ID, config.Source)
		left, _ := json.Marshal(got.Values)
		right, _ := json.Marshal(config.Values)
		if buildErr != nil || !bytes.Equal(left, right) {
			t.Fatalf("controlled %s config differs: err=%v observed=%s candidate=%s", config.Kind, buildErr, left, right)
		}
	}
	blockHash, headHash := candidate.BlockHash, receipt.Header.Hash
	headNumber, lag := candidate.BlockNumber, "0"
	accounts := make([]readmodel.UserAccountReadModel, len(candidate.Accounts))
	for i, account := range candidate.Accounts {
		accounts[i] = readmodel.UserAccountReadModel{User: account.User, AssetUID: account.AssetUID, Vault: account.Vault, Deposited: account.Deposited, Allocated: account.Allocated, Free: account.Free, Source: account.Source}
	}
	snapshot := readmodel.Snapshot{ExecutionSpecID: "V1-EXEC-11", ReconciliationAlerts: []json.RawMessage{}, Sync: readmodel.SyncStatus{ChainID: candidate.ChainID, Status: "synced", BlockNumber: &candidate.BlockNumber, BlockHash: &blockHash, Finality: "finalized", HeadBlockNumber: &headNumber, HeadBlockHash: &headHash, LagBlocks: &lag, Revision: candidate.BlockNumber + ":" + candidate.BlockHash}, Markets: candidate.Markets, Configs: candidate.Configs, Accounts: &accounts, Positions: candidate.Positions}
	snapshotRaw, _ := json.Marshal(snapshot)
	parsedSnapshot, parseErr := readmodel.Parse(snapshotRaw, candidate.ChainID)
	if parseErr != nil {
		t.Fatalf("controlled publication snapshot invalid: %v payload=%s", parseErr, snapshotRaw)
	}
	parsedRaw, _ := json.Marshal(parsedSnapshot)
	if !bytes.Equal(parsedRaw, snapshotRaw) {
		t.Fatalf("controlled publication snapshot is not canonical: parsed=%s source=%s", parsedRaw, snapshotRaw)
	}
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, "manifest.json")
	if os.WriteFile(manifestPath, manifestRaw, 0o600) != nil {
		t.Fatal("cannot write manifest")
	}
	run := func() ([]byte, []byte, error) {
		command := osexec.CommandContext(ctx, "go", "run", "-race", "./cmd/candidate-inspect", "--publish")
		command.Dir = ".."
		command.Env = append(os.Environ(), "TG_CANDIDATE_DATABASE_URL="+u.String(), "TG_PUBLISHER_DATABASE_URL="+u.String(), "TG_DEPLOYMENT_MANIFEST="+manifestPath, "TG_PROJECTION_START_BLOCK=10", "TG_CANDIDATE_RPC_URL="+primary.URL, "TG_CANDIDATE_INDEPENDENT_RPC_URL="+secondary.URL)
		var stdout, stderr bytes.Buffer
		command.Stdout, command.Stderr = &stdout, &stderr
		err := command.Run()
		return stdout.Bytes(), stderr.Bytes(), err
	}
	for attempt := 0; attempt < 2; attempt++ {
		stdout, stderr, runErr := run()
		if runErr != nil || !bytes.Contains(stdout, []byte(`"status":"published"`)) {
			t.Fatalf("publication attempt %d failed: %v stdout=%s stderr=%s", attempt+1, runErr, stdout, stderr)
		}
	}
	var snapshots, evidence int
	if pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.read_snapshots`).Scan(&snapshots) != nil || snapshots != 1 {
		t.Fatalf("snapshot count=%d, want idempotent 1", snapshots)
	}
	if pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.read_snapshot_evidence`).Scan(&evidence) != nil || evidence != 1 {
		t.Fatalf("evidence count=%d, want idempotent 1", evidence)
	}
}
