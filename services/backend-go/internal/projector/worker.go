// Package projector persists authenticated V1 business facts. These tables are
// not reconciled balances and are not published to the read API automatically.
package projector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/observationwork"
	"tickergarden/backend/internal/projection"
	"tickergarden/backend/internal/useractivity"
)

const Version = "V1-EXEC-11:business-facts-v25-asset-minimum"

const ObservationScope = "market-curve-gauge-vault-fees-holder-config-route-accounts-gauge-principal-v1"

type Worker struct {
	ObservationQueue        *observationwork.Store
	ObservationRPC          deployment.BindingObserver
	Pool                    *pgxpool.Pool
	RPC                     deployment.BindingObserver
	Manifest                deployment.Manifest
	StartBlock              uint64
	EventsOnly              bool   // Independent display/event lane; never produces financial observations.
	FinancialEmptyBatchSize uint64 // 0 disables; otherwise 2..256, full observations at the selected end.
	cacheEventsOnly         bool
	mu                      sync.Mutex
	cache                   *projection.State
	cacheHash               string
}
type Result struct {
	Action        string                `json:"action"`
	BlockNumber   *uint64               `json:"blockNumber,omitempty"`
	Lane          string                `json:"lane,omitempty"`
	Events        int                   `json:"events"`
	ReadStats     *deployment.ReadStats `json:"rpcReads,omitempty"`
	StageMillis   map[string]int64      `json:"stageMillis,omitempty"`
	ElapsedMillis int64                 `json:"elapsedMillis,omitempty"`
}

func (w *Worker) Step(ctx context.Context) (Result, error) {
	return w.step(ctx, false)
}

// BackfillActivity repairs missing or obsolete activity batches without rewinding
// business projection state. Each call commits at most one authenticated block.
func (w *Worker) BackfillActivity(ctx context.Context) (Result, error) {
	return w.step(ctx, true)
}

func (w *Worker) step(ctx context.Context, activityOnly bool) (Result, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if activityOnly && w.EventsOnly {
		return Result{}, errors.New("activity backfill is not an event lane operation")
	}
	fail := func(err error) (Result, error) {
		w.cache = nil
		if ctx.Err() != nil {
			return Result{}, fmt.Errorf("projection step interrupted: %w", ctx.Err())
		}
		return Result{}, err
	}
	if w.Pool == nil || w.RPC == nil || w.StartBlock > 1<<63-1 {
		return fail(errors.New("invalid projection configuration"))
	}
	m := w.Manifest
	m.Contracts = append([]deployment.Contract{}, m.Contracts...)
	sort.Slice(m.Contracts, func(i, j int) bool { return m.Contracts[i].Address < m.Contracts[j].Address })
	raw, _ := json.Marshal(m)
	if _, err := deployment.Parse(raw); err != nil {
		return fail(err)
	}
	commitment, chain := deployment.Hash(raw), m.ChainID
	tx, err := w.Pool.Begin(ctx)
	if err != nil {
		return fail(errors.New("cannot begin projection transaction"))
	}
	defer tx.Rollback(context.Background())
	var locked bool
	leaseKey := w.leaseKey(chain)
	if activityOnly {
		leaseKey = int64(750000000 + chain)
	}
	if err = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock($1)", leaseKey).Scan(&locked); err != nil {
		return fail(errors.New("cannot lock projection chain"))
	}
	if !locked {
		return Result{Action: "busy"}, nil
	}
	var discoveryHash, genesis string
	var discoveryStart uint64
	var discovered, finalized *uint64
	var discoveryTipHash *string
	err = tx.QueryRow(ctx, `SELECT d.manifest_hash,d.start_block,d.tip_number,j.finalized_number,j.genesis_hash,d.tip_hash FROM tickergarden.discovery_checkpoints d JOIN tickergarden.chain_journal j USING(chain_id) WHERE d.chain_id=$1`, chain).Scan(&discoveryHash, &discoveryStart, &discovered, &finalized, &genesis, &discoveryTipHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{Action: "waiting_for_discovery"}, nil
	}
	if err != nil {
		return fail(errors.New("cannot read discovery prerequisite"))
	}
	if discoveryHash != commitment || discoveryStart != w.StartBlock || genesis != m.GenesisHash {
		return fail(errors.New("projection and discovery scope mismatch"))
	}
	if discovered != nil {
		var valid bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND hash=$3 AND canonical AND events_verified)`, chain, *discovered, discoveryTipHash).Scan(&valid); err != nil {
			return fail(err)
		}
		if !valid || finalized == nil || *discovered > *finalized {
			return fail(errors.New("upstream discovery checkpoint invalidated"))
		}
	}
	var tipHash *string
	var inputCount uint64
	next := w.StartBlock
	if activityOnly {
		if discovered == nil || finalized == nil || *discovered < w.StartBlock {
			return Result{Action: "waiting_for_discovery"}, nil
		}
		var pending bool
		next, pending, err = nextActivityBlock(ctx, tx, chain, w.StartBlock, *discovered, commitment, m.GenesisHash)
		if err != nil {
			return fail(err)
		}
		if !pending {
			return Result{Action: "idle"}, nil
		}
	} else {
		if _, err = tx.Exec(ctx, w.sqlForLane(`INSERT INTO tickergarden.projection_checkpoints(chain_id,manifest_hash,projector_version,start_block) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`), chain, commitment, w.version(), w.StartBlock); err != nil {
			return fail(errors.New("cannot initialize projection; run migrations first"))
		}
		var saved, version string
		var start uint64
		var tip *uint64
		if err = tx.QueryRow(ctx, w.sqlForLane(`SELECT manifest_hash,projector_version,start_block,tip_number,tip_hash,input_count FROM tickergarden.projection_checkpoints WHERE chain_id=$1 FOR UPDATE`), chain).Scan(&saved, &version, &start, &tip, &tipHash, &inputCount); err != nil {
			return fail(errors.New("cannot read projection checkpoint"))
		}
		if saved != commitment || version != w.version() || start != w.StartBlock {
			return fail(errors.New("projection scope or version changed; explicit rebuild required"))
		}
		next = start
		if tip != nil {
			var valid bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND hash=$3 AND canonical AND events_verified)`, chain, *tip, *tipHash).Scan(&valid); err != nil {
				return fail(err)
			}
			if !valid || finalized == nil || discovered == nil || *tip > *finalized || *tip > *discovered {
				return fail(errors.New("projection checkpoint invalidated"))
			}
			h, err := w.RPC.Header(ctx, fmt.Sprintf("0x%x", *tip))
			if err != nil {
				return fail(err)
			}
			if !strings.EqualFold(h.Hash, *tipHash) {
				return fail(errors.New("projection finalized checkpoint changed on RPC"))
			}
			next = *tip + 1
		}
		if discovered == nil || finalized == nil || next > *discovered || next > *finalized {
			if err = tx.Commit(ctx); err != nil {
				return fail(err)
			}
			return Result{Action: "idle"}, nil
		}

	}
	var header chainrpc.Header
	var blockTime uint64
	header.Number = fmt.Sprintf("0x%x", next)
	err = tx.QueryRow(ctx, `SELECT b.hash,b.parent_hash,b.block_timestamp FROM tickergarden.chain_blocks b JOIN tickergarden.discovery_batches d ON d.chain_id=b.chain_id AND d.block_hash=b.hash WHERE b.chain_id=$1 AND b.number=$2 AND b.canonical AND b.events_verified AND b.block_timestamp IS NOT NULL`, chain, next).Scan(&header.Hash, &header.ParentHash, &blockTime)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{Action: "waiting_for_discovery"}, nil
	}
	if err != nil {
		return fail(err)
	}
	header.Timestamp = fmt.Sprintf("0x%x", blockTime)
	if tipHash != nil && header.ParentHash != *tipHash {
		return fail(errors.New("projection parent mismatch"))
	}
	final, err := w.RPC.Header(ctx, "finalized")
	if err != nil {
		return fail(err)
	}
	finalN, err := final.Height()
	if err != nil || finalN < next {
		return fail(errors.New("projection source is no longer finalized"))
	}
	if !w.EventsOnly && !activityOnly && tipHash != nil && w.FinancialEmptyBatchSize != 0 {
		if w.FinancialEmptyBatchSize < 2 || w.FinancialEmptyBatchSize > 256 {
			return fail(errors.New("invalid financial empty batch size"))
		}
		end, e := w.emptyFinancialEnd(ctx, tx, chain, header, min(finalN, *discovered, *finalized, next+w.FinancialEmptyBatchSize-1))
		if e != nil {
			return fail(e)
		}
		header = end
		next, e = header.Height()
		if e != nil {
			return fail(e)
		}
	}
	// Bind only dynamic identities emitting in this block, keeping manifest limits
	// independent of total historical market count.
	rows, err := tx.Query(ctx, `SELECT payload FROM tickergarden.chain_logs WHERE chain_id=$1 AND block_hash=$2 ORDER BY log_index`, chain, header.Hash)
	if err != nil {
		return fail(err)
	}
	logs := []chainrpc.Log{}
	addresses := map[string]bool{}
	for rows.Next() {
		var data []byte
		var log chainrpc.Log
		if err = rows.Scan(&data); err != nil {
			break
		}
		if err = json.Unmarshal(data, &log); err != nil {
			break
		}
		logs = append(logs, log)
		addresses[strings.ToLower(log.Address)] = true
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return fail(errors.New("invalid projection journal log"))
	}
	if w.EventsOnly {
		ceiling := min(finalN, *discovered, *finalized, next+255)
		candidates, e := w.candidateEmitters(ctx, tx, chain, ceiling)
		if e != nil {
			return fail(e)
		}
		interested := map[string]bool{}
		for _, a := range candidates {
			interested[a] = true
		}
		relevant := false
		for _, log := range logs {
			if interested[strings.ToLower(log.Address)] {
				relevant = true
				break
			}
		}
		if !relevant {
			result, e := w.finishEmptyEvents(ctx, tx, chain, header, inputCount, ceiling, candidates)
			if e != nil {
				return fail(e)
			}
			return result, nil
		}
	}

	known := map[string]deployment.Contract{}
	for _, c := range m.Contracts {
		known[c.Address] = c
	}
	markets := map[string]deployment.MarketDiscovery{}
	rows, err = tx.Query(ctx, `SELECT m.payload FROM tickergarden.canonical_discovered_markets m JOIN tickergarden.chain_blocks b ON b.chain_id=m.chain_id AND b.hash=m.block_hash WHERE m.chain_id=$1 AND b.number<=$2`, chain, next)
	if err != nil {
		return fail(err)
	}
	for rows.Next() {
		var data []byte
		var market deployment.MarketDiscovery
		if err = rows.Scan(&data); err != nil {
			break
		}
		if err = json.Unmarshal(data, &market); err != nil {
			break
		}
		markets[market.MarketID] = market
		for _, c := range market.Contracts {
			if !addresses[c.Address] {
				continue
			}
			if old, exists := known[c.Address]; exists && old != c {
				err = errors.New("conflicting discovered runtime identity")
				break
			}
			known[c.Address] = c
		}
		if err != nil {
			break
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return fail(err)
	}
	bound := m
	bound.Contracts = nil
	for _, c := range known {
		bound.Contracts = append(bound.Contracts, c)
	}
	readStarted := time.Now()
	stageStarted := readStarted
	stages := map[string]int64{}
	markStage := func(name string) { stages[name] = time.Since(stageStarted).Milliseconds(); stageStarted = time.Now() }
	rpc := deployment.NewReadSession(w.RPC, header.Hash)
	verified, err := deployment.VerifyCoreBindings(ctx, rpc, bound, header)
	if err != nil {
		return fail(err)
	}
	// Registry-backed asset scope survives without a market through projected
	// AssetRegistered configs. Include registrations in this block before decoding
	// Vault logs, so registration and first deposit may share a transaction.
	assetIDs := map[string]bool{}
	for _, market := range markets {
		if market.State["stakingEnabled"] == true {
			assetIDs[market.State["assetUid"].(string)] = true
		}
	}
	var registry string
	for _, c := range m.Contracts {
		if c.Module == "OfficialStockRegistryV1" {
			registry = c.Address
		}
	}
	if activityOnly {
		// Candidate IDs only: DiscoverAssets authenticates each against the registry
		// at this historical hash. Do not use today's overwritten config rows.
		rows, err = tx.Query(ctx, `SELECT DISTINCT l.payload->'topics'->>1 FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash WHERE l.chain_id=$1 AND b.canonical AND b.events_verified AND b.number<=$2 AND l.address=$3 AND l.payload->'topics'->>0=$4 LIMIT 10001`, chain, next, registry, deployment.Hash([]byte("AssetRegistered(bytes32,address,address,uint8)")))
	} else {
		rows, err = tx.Query(ctx, w.sqlForLane(`SELECT payload->>'id' FROM tickergarden.canonical_projection_rows WHERE chain_id=$1 AND table_name='configs' AND payload->>'kind'='asset'`), chain)
	}
	if err != nil {
		return fail(err)
	}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			break
		}
		assetIDs[id] = true
		if activityOnly && len(assetIDs) > 10000 {
			err = errors.New("activity asset scope exceeds budget")
			break
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return fail(err)
	}
	registrations := map[string]map[string]any{}
	for _, log := range logs {
		if !strings.EqualFold(log.Address, registry) {
			continue
		}
		event, e := verified.Decode(chain, log)
		if errors.Is(e, events.ErrUnknown) {
			continue
		}
		if e != nil {
			return fail(e)
		}
		if id, ok := event.Args["assetUid"].(string); ok {
			assetIDs[id] = true
			if strings.HasPrefix(event.Signature, "AssetRegistered(") {
				if registrations[id] != nil {
					return fail(errors.New("duplicate asset registration"))
				}
				registrations[id] = event.Args
			}
		}
	}
	if activityOnly && len(assetIDs) > 10000 {
		return fail(errors.New("activity asset scope exceeds budget"))
	}
	assets, err := deployment.DiscoverAssets(ctx, rpc, bound, header, assetIDs)
	if err != nil {
		return fail(err)
	}
	for id, args := range registrations {
		for _, field := range []string{"stockToken", "userStockVault", "tokenDecimals"} {
			if assets[id].State[field] != args[field] {
				return fail(errors.New("asset registration and Registry mismatch: " + field))
			}
		}
	}
	for _, asset := range assets {
		c := asset.Vault
		if old, exists := known[c.Address]; exists && old != c {
			return fail(errors.New("conflicting canonical Vault identity"))
		}
		known[c.Address] = c
	}
	bound.Contracts = nil
	for _, c := range known {
		bound.Contracts = append(bound.Contracts, c)
	}
	verified, err = deployment.VerifyCoreBindings(ctx, rpc, bound, header)
	if err != nil {
		return fail(err)
	}
	if activityOnly {
		if err = useractivity.IndexBlock(ctx, tx, chain, header, commitment, verified); err != nil {
			return fail(err)
		}
		endChain, e := w.RPC.ChainID(ctx)
		if e != nil || endChain != chain {
			return fail(errors.New("activity chain changed before commit"))
		}
		end, e := w.RPC.Header(ctx, header.Number)
		if e != nil || !strings.EqualFold(end.Hash, header.Hash) || end.Timestamp != header.Timestamp {
			return fail(errors.New("activity source changed before commit"))
		}
		if err = tx.Commit(ctx); err != nil {
			return fail(err)
		}
		return Result{Action: "activity_backfilled", BlockNumber: &next}, nil
	}
	state := w.cache
	if state == nil || tipHash == nil || w.cacheHash != *tipHash || w.cacheEventsOnly != w.EventsOnly {
		state = projection.New()
		replayCount := uint64(0)
		rows, err = tx.Query(ctx, w.sqlForLane(`SELECT p.payload,p.digest,l.payload FROM tickergarden.projection_inputs p JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.block_hash JOIN tickergarden.chain_logs l ON l.chain_id=p.chain_id AND l.block_hash=p.block_hash AND l.log_index=p.log_index WHERE p.chain_id=$1 AND b.canonical AND b.events_verified ORDER BY b.number,p.log_index`), chain)
		if err != nil {
			return fail(err)
		}
		for rows.Next() {
			var data, source []byte
			var digest string
			var input projection.Input
			var log chainrpc.Log
			if err = rows.Scan(&data, &digest, &source); err != nil {
				break
			}
			if deployment.Hash(data) != digest || json.Unmarshal(data, &input) != nil || json.Unmarshal(source, &log) != nil || input.ChainID != chain || !reflect.DeepEqual(input.Log, log) {
				err = errors.New("projection replay input integrity mismatch")
				break
			}
			replayCount++
			if _, err = state.Apply(input); err != nil {
				break
			}
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			return fail(err)
		}
		if replayCount != inputCount {
			return fail(errors.New("projection replay input count mismatch"))
		}
	}
	// Any error after mutation discards cache; the next attempt rebuilds only the
	// committed event sequence. No failed block is reused in memory.
	w.cache = nil
	applied := 0
	for _, log := range logs {
		decoded, err := verified.Decode(chain, log)
		if errors.Is(err, events.ErrUnknown) {
			continue
		}
		if err != nil {
			return fail(err)
		}
		input := projection.Input{ChainID: chain, Module: decoded.Module, Log: log}
		if strings.HasPrefix(decoded.Signature, "MarketCreated(") {
			market, ok := markets[fmt.Sprint(decoded.Args["marketId"])]
			if !ok || !reflect.DeepEqual(market.Source, log) {
				return fail(errors.New("market creation lacks matching discovery observation"))
			}
			input.Observations = []projection.Observation{{Kind: "market", Key: market.MarketID, Value: projection.Row(market.State)}}
		}
		if status, err := state.Apply(input); err != nil {
			return fail(err)
		} else if status != "applied" {
			return fail(errors.New("duplicate event in new projection block"))
		}
		index, err := chainrpc.Quantity(log.LogIndex)
		if err != nil {
			return fail(err)
		}
		data, err := json.Marshal(input)
		if err != nil {
			return fail(err)
		}
		if _, err = tx.Exec(ctx, w.sqlForLane(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,$3,$4,$5)`), chain, header.Hash, index, data, deployment.Hash(data)); err != nil {
			return fail(errors.New("cannot persist projection input"))
		}
		changes, err := state.Changes()
		if err != nil {
			return fail(err)
		}
		for _, change := range changes {
			if _, err = tx.Exec(ctx, w.sqlForLane(`INSERT INTO tickergarden.projection_rows(chain_id,table_name,row_key,payload,block_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(chain_id,table_name,row_key) DO UPDATE SET payload=EXCLUDED.payload,block_hash=EXCLUDED.block_hash`), chain, change.Table, change.Key, []byte(change.Value), header.Hash); err != nil {
				return fail(errors.New("cannot persist projection row"))
			}
		}
		applied++
	}
	if w.EventsOnly {
		result, e := w.finishEvents(ctx, tx, chain, header, inputCount+uint64(applied), applied)
		if e != nil {
			return fail(e)
		}
		w.cache = state
		w.cacheHash = header.Hash
		w.cacheEventsOnly = true
		stats := rpc.Stats()
		result.ReadStats = &stats
		result.ElapsedMillis = time.Since(readStarted).Milliseconds()
		return result, nil
	}
	if err = useractivity.IndexBlock(ctx, tx, chain, header, commitment, verified); err != nil {
		return fail(err)
	}
	// Persist block-end views separately from ordered event facts. No view is
	// replayed once per event or attributed to an individual transaction.

	// Old refund asset dependencies survive epoch resets.
	historical, err := historicalServiceAssets(ctx, tx, chain)
	if err != nil {
		return fail(err)
	}
	var feeRows, holderRows deployment.ObservationBatch
	if w.ObservationQueue != nil {
		requests, e := observationwork.Plan(bound, header, markets, historical)
		if e != nil {
			return fail(e)
		}
		source := w.ObservationRPC
		if source == nil {
			source = w.RPC
		}
		feeRows, holderRows, err = w.ObservationQueue.Resolve(ctx, requests, func(c context.Context, r observationwork.Request) (deployment.ObservationBatch, error) {
			return observationwork.Execute(c, source, r)
		})
	} else {
		feeRows, err = deployment.ObserveFeeBlock(ctx, rpc, bound, header, markets)
		if err == nil {
			holderRows, err = deployment.ObserveHolderBlock(ctx, rpc, bound, header, markets, historical...)
		}
	}
	if err != nil {
		return fail(err)
	}
	markStage("feeHolderWork")

	gaugeRows, err := tx.Query(ctx, w.sqlForLane(`SELECT row_key FROM tickergarden.projection_rows WHERE chain_id=$1 AND table_name='gaugePositions' LIMIT 10001`), chain)
	if err != nil {
		return fail(err)
	}
	gaugeAccounts := []deployment.GaugeAccount{}
	for gaugeRows.Next() {
		var key string
		if err = gaugeRows.Scan(&key); err != nil {
			break
		}
		parts := strings.Split(key, ":")
		if len(parts) != 2 {
			err = errors.New("invalid Gauge projection key")
			break
		}
		gaugeAccounts = append(gaugeAccounts, deployment.GaugeAccount{User: parts[0], MarketID: parts[1]})
	}
	if err == nil {
		err = gaugeRows.Err()
	}
	gaugeRows.Close()
	if err != nil {
		return fail(err)
	}
	markStage("eventsAndIdentity")
	batch, err := deployment.ObserveDirectoryBlock(ctx, rpc, bound, header, markets, logs, gaugeAccounts...)
	if err != nil {
		return fail(err)
	}

	accountRows, err := tx.Query(ctx, w.sqlForLane(`SELECT row_key FROM tickergarden.projection_rows WHERE chain_id=$1 AND table_name IN ('stockPositions','allocations') LIMIT 10001`), chain)
	if err != nil {
		return fail(err)
	}
	accounts := []deployment.VaultAccount{}
	for accountRows.Next() {
		var key string
		if err = accountRows.Scan(&key); err != nil {
			break
		}
		parts := strings.Split(key, ":")
		if len(parts) != 2 && len(parts) != 3 {
			err = errors.New("invalid Vault account projection key")
			break
		}
		account := deployment.VaultAccount{AssetUID: parts[0], User: parts[1]}
		if len(parts) == 3 {
			account.MarketID = parts[2]
		}
		accounts = append(accounts, account)
	}
	if err == nil {
		err = accountRows.Err()
	}
	accountRows.Close()
	if err != nil {
		return fail(err)
	}
	markStage("directory")
	vaultRows, err := deployment.ObserveAssetBlock(ctx, rpc, header, chain, verified, assets, markets, logs, accounts...)
	if err != nil {
		return fail(err)
	}
	batch.Scope = deployment.VaultObservationScope
	batch.Expected += vaultRows.Expected
	batch.Observations = append(batch.Observations, vaultRows.Observations...)
	markStage("vault")
	batch.Expected += holderRows.Expected
	batch.Observations = append(batch.Observations, holderRows.Observations...)
	batch.Scope = deployment.HolderObservationScope
	batch.Expected += feeRows.Expected
	batch.Observations = append(batch.Observations, feeRows.Observations...)

	markStage("holders")
	// Refresh all event-discovered configs, including registrations applied above.
	configRows, err := tx.Query(ctx, w.sqlForLane(`SELECT payload->>'kind',payload->>'id' FROM tickergarden.projection_rows WHERE chain_id=$1 AND table_name='configs' AND payload->>'kind' IN ('quote','baseline','template') LIMIT 1025`), chain)
	if err != nil {
		return fail(err)
	}
	targets := []deployment.ConfigTarget{}
	for configRows.Next() {
		var target deployment.ConfigTarget
		if err = configRows.Scan(&target.Kind, &target.ID); err != nil {
			break
		}
		targets = append(targets, target)
	}
	if err == nil {
		err = configRows.Err()
	}
	configRows.Close()
	if err != nil {
		return fail(err)
	}
	configBatch, err := deployment.ObserveConfigBlock(ctx, rpc, bound, header, targets)
	if err != nil {
		return fail(err)
	}
	batch.Expected += configBatch.Expected
	batch.Observations = append(batch.Observations, configBatch.Observations...)
	batch.Scope = deployment.ConfigObservationScope

	markStage("configs")
	if len(markets) > 1024 {
		return fail(errors.New("route observation budget exceeded"))
	}
	routeIDs := make([]string, 0, len(markets))
	for id := range markets {
		routeIDs = append(routeIDs, id)
	}
	sort.Strings(routeIDs)
	for _, id := range routeIDs {
		routes, e := deployment.ObserveMarketRoute(ctx, rpc, bound, header, id)
		if e != nil {
			return fail(e)
		}
		batch.Expected += routes.Expected
		batch.Observations = append(batch.Observations, routes.Observations...)
	}
	batch.Scope = "market-curve-gauge-vault-fees-holder-config-route-accounts-gauge-v1"
	principalRows, err := principalObservations(ctx, tx, chain, next, w.StartBlock, header.Hash, tipHash, commitment, inputCount, batch.Observations)
	if err != nil {
		return fail(err)
	}
	batch.Expected += len(principalRows)
	batch.Observations = append(batch.Observations, principalRows...)
	rewardRows, err := rewardObservations(ctx, tx, uint64(chain), batch.Observations)
	if err != nil {
		return fail(err)
	}
	batch.Expected += len(rewardRows)
	batch.Observations = append(batch.Observations, rewardRows...)
	conversionRows, err := conversionObservations(ctx, tx, uint64(chain), header.Hash, batch.Observations)
	if err != nil {
		return fail(err)
	}
	batch.Expected += len(conversionRows)
	batch.Observations = append(batch.Observations, conversionRows...)
	markStage("routesAndReconciliation")
	batch.Scope = ObservationScope
	data, err := json.Marshal(batch)
	if err != nil {
		return fail(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO tickergarden.projection_observation_batches(chain_id,block_hash,scope,expected_count,completed_count,payload,digest) VALUES($1,$2,$3,$4,$5,$6,$7)`, chain, header.Hash, batch.Scope, batch.Expected, len(batch.Observations), data, deployment.Hash(data)); err != nil {
		return fail(errors.New("cannot persist observation batch"))
	}
	for _, observation := range batch.Observations {
		value, err := json.Marshal(observation.Value)
		if err != nil {
			return fail(err)
		}
		if _, err = tx.Exec(ctx, `INSERT INTO tickergarden.projection_block_observations(chain_id,block_hash,kind,observation_key,value) VALUES($1,$2,$3,$4,$5)`, chain, header.Hash, observation.Kind, observation.Key, value); err != nil {
			return fail(errors.New("cannot persist block observation"))
		}
	}
	endChain, err := w.RPC.ChainID(ctx)
	if err != nil || endChain != chain {
		return fail(errors.New("projection chain identity changed before commit"))
	}
	end, err := w.RPC.Header(ctx, header.Number)
	if err != nil {
		return fail(err)
	}
	if !strings.EqualFold(end.Hash, header.Hash) || end.Timestamp != header.Timestamp {
		return fail(errors.New("projection block changed before commit"))
	}
	if _, err = tx.Exec(ctx, w.sqlForLane(`UPDATE tickergarden.projection_checkpoints SET tip_number=$2,tip_hash=$3,input_count=$4,updated_at=now() WHERE chain_id=$1`), chain, next, header.Hash, inputCount+uint64(applied)); err != nil {
		return fail(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return fail(errors.New("cannot commit projection block"))
	}
	w.cache = state
	w.cacheHash = header.Hash
	w.cacheEventsOnly = false
	markStage("persistAndCommit")
	stats := rpc.Stats()
	return Result{Action: "projected", BlockNumber: &next, Events: applied, ReadStats: &stats, StageMillis: stages, ElapsedMillis: time.Since(readStarted).Milliseconds()}, nil
}
