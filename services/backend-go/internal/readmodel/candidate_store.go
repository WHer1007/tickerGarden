package readmodel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"reflect"
	"sort"
	"strconv"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/feeledger"
	"tickergarden/backend/internal/journal"
	"tickergarden/backend/internal/projection"
	"time"
)

// LoadCandidateSet replays stored projection inputs to derive event provenance,
// then assembles the same-transaction current batch after checking continuous
// locally committed receipt history. It does not independently reauthenticate
// every event emitter or prove an Ethereum receipt trie.
func (s *ObservationStore) LoadCandidateSet(ctx context.Context) (CandidateSet, error) {
	fail := func() (CandidateSet, error) {
		return CandidateSet{}, errors.New("candidate provenance or assembly unavailable")
	}
	if s.Pool == nil || !candidateHash.MatchString(s.GenesisHash) || !candidateHash.MatchString(s.ManifestHash) || s.Version == "" || s.Scope == "" {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return fail()
	}
	defer tx.Rollback(context.Background())
	batch, e := s.loadCandidateBatch(ctx, tx)
	if e != nil {
		return fail()
	}
	var count uint64
	if tx.QueryRow(ctx, `SELECT input_count FROM tickergarden.projection_checkpoints WHERE chain_id=$1`, s.ChainID).Scan(&count) != nil || count > 100000 {
		return fail()
	}
	height, _ := strconv.ParseUint(batch.BlockNumber, 0, 64)
	historyRootsVerified, historyErr := s.verifyCandidateHistory(ctx, tx, height, batch.BlockHash)
	if historyErr != nil {
		return fail()
	}
	discoveries, e := s.candidateDiscoveries(ctx, tx, height)
	if e != nil {
		return fail()
	}
	var emitters *candidateEmitterBindings
	if s.EmitterManifest != nil {
		m := *s.EmitterManifest
		if m.ChainID != s.ChainID || m.GenesisHash != s.GenesisHash || candidateManifestHash(m) != s.ManifestHash {
			return fail()
		}
		emitters, e = newCandidateEmitterBindings(m, discoveries)
		if e != nil {
			return fail()
		}
	}
	if emitters != nil && s.bindCandidateRegistrations(ctx, tx, height, emitters) != nil {
		return fail()
	}

	historyEventsVerified := false
	historyEmitters := []string{}
	if emitters != nil {
		inventory := map[string]uint64{}
		for address, binding := range emitters.addresses {
			// No project can emit PoolManager events before a market exists. Once a
			// market exists, conservative full PoolManager coverage remains required.
			if binding.module == "UniswapV4PoolManager" && len(discoveries) == 0 {
				continue
			}
			inventory[address] = binding.from
			historyEmitters = append(historyEmitters, address)
		}
		historyEventsVerified, e = journal.VerifyStoredEventExclusions(ctx, tx, s.ChainID, s.StartBlock, height, inventory)
		if e != nil {
			return fail()
		}
	}
	rows, e := tx.Query(ctx, `SELECT p.payload,p.digest,l.payload,b.number,b.hash,p.log_index,b.block_timestamp
 FROM tickergarden.projection_inputs p JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.block_hash
 LEFT JOIN tickergarden.chain_logs l ON l.chain_id=p.chain_id AND l.block_hash=p.block_hash AND l.log_index=p.log_index
 WHERE p.chain_id=$1 AND b.canonical AND b.events_verified AND b.number BETWEEN $2 AND $3
 ORDER BY b.number,p.log_index LIMIT 100001`, s.ChainID, s.StartBlock, height)
	if e != nil {
		return fail()
	}
	defer rows.Close()
	state := projection.New()
	feeInputs := []feeledger.Input{}
	claims := newHolderClaimHistory()
	streams := newHolderStreamHistory()
	inputInventory := map[string]string{}
	seen := uint64(0)
	size := 0
	for rows.Next() {
		var data, rawLog []byte
		var digest, hash string
		var n, index, inputTimestamp uint64
		if rows.Scan(&data, &digest, &rawLog, &n, &hash, &index, &inputTimestamp) != nil {
			return fail()
		}
		seen++
		size += len(data) + len(rawLog)
		if seen > count || size > 64<<20 || deployment.Hash(data) != digest {
			return fail()
		}
		var input projection.Input
		var log chainrpc.Log
		if uniqueJSON(json.NewDecoder(bytes.NewReader(data)), 0) != nil || uniqueJSON(json.NewDecoder(bytes.NewReader(rawLog)), 0) != nil {
			return fail()
		}
		if json.Unmarshal(data, &input) != nil || json.Unmarshal(rawLog, &log) != nil || input.ChainID != s.ChainID || !reflect.DeepEqual(input.Log, log) || log.Removed || log.BlockHash != hash || log.BlockNumber != "0x"+strconv.FormatUint(n, 16) || log.LogIndex != "0x"+strconv.FormatUint(index, 16) {
			return fail()
		}
		if emitters != nil && emitters.check(input) != nil {
			return fail()
		}
		if verifyCandidateInputViews(input, discoveries) != nil {
			return fail()
		}
		inputInventory[log.BlockHash+":"+log.LogIndex] = input.Module
		switch input.Module {
		case "ProtocolFeeVault", "TreasuryDistributorV1", "HolderRewardsDistributorV1":
			feeInputs = append(feeInputs, feeledger.Input{Module: input.Module, Log: log})
		}
		if e := streams.add(input, inputTimestamp); e != nil {
			return fail()
		}
		if e := claims.add(input, inputTimestamp); e != nil {
			return fail()
		}
		if _, e := state.Apply(input); e != nil {
			return fail()
		}
	}
	if rows.Err() != nil || seen != count {
		return fail()
	}
	rows.Close()
	if emitters != nil && s.verifyCandidateInventory(ctx, tx, height, emitters, inputInventory) != nil {
		return fail()
	}
	encoded, e := state.Snapshot()
	if e != nil || len(encoded) > 64<<20 {
		return fail()
	}
	var snapshot struct {
		Tables map[string]map[string]json.RawMessage `json:"tables"`
	}
	if json.Unmarshal(encoded, &snapshot) != nil {
		return fail()
	}
	if verifyCandidateConfigEvidence(batch, snapshot.Tables["configs"]) != nil {
		return fail()
	}
	if verifyCandidateMarketEvidence(batch, discoveries, snapshot.Tables["markets"]) != nil {
		return fail()
	}
	for id := range discoveries {
		if len(snapshot.Tables["markets"][id]) == 0 {
			return fail()
		}
	}
	sources := map[string]SourceBlock{}
	for _, o := range batch.Observations {
		table, key, target := "", o.Key, ""
		switch o.Kind {
		case "market":
			table = "markets"
			target = "market:" + key
		case "quote", "baseline", "template", "asset":
			table = "configs"
			key = o.Kind + ":" + key
			target = "config:" + key
		case "gaugePosition":
			table = "gaugePositions"
			target = "position:" + key
		case "vaultPosition":
			table = "stockPositions"
			target = "account:" + key
		default:
			continue
		}
		var row struct {
			Provenance SourceBlock `json:"provenance"`
		}
		if json.Unmarshal(snapshot.Tables[table][key], &row) != nil {
			return fail()
		}
		sources[target] = row.Provenance
	}
	for table, prefix := range map[string]string{"markets": "market:", "configs": "config:", "gaugePositions": "position:", "stockPositions": "account:"} {
		for key := range snapshot.Tables[table] {
			if _, ok := sources[prefix+key]; !ok {
				return fail()
			}
		}
	}
	result, e := BuildCandidateSet(batch, sources)
	if e != nil || verifyStoredFeeCoverage(result, batch) != nil || verifyStoredHolderSolvency(result.HolderMarkets, batch, claims.service) != nil {
		return fail()
	}
	var blockTimestamp uint64
	if tx.QueryRow(ctx, `SELECT block_timestamp FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND hash=$3 AND canonical AND events_verified`, s.ChainID, height, batch.BlockHash).Scan(&blockTimestamp) != nil || verifyCreatorCandidateTime(result.CreatorEpochs, blockTimestamp) != nil || verifyHolderCandidateTime(result.HolderMarkets, height, blockTimestamp) != nil {
		return fail()
	}
	if streams.verify(result.HolderMarkets) != nil || claims.verify(result.HolderMarkets) != nil || claims.verifyTiming(result.HolderMarkets) != nil || claims.verifyServiceLiability(result.HolderMarkets, batch) != nil || s.verifyHolderSourceBlocks(ctx, tx, result.HolderMarkets, claims.requestSources) != nil {
		return fail()
	}
	result.FeeClaims, e = buildFeeClaimCandidates(snapshot.Tables["feeClaimTotals"], result)
	if e != nil {
		return fail()
	}
	result.HistoryReceiptRootsVerified = historyRootsVerified
	result.HistoryEventCoverageVerified = historyEventsVerified
	sort.Strings(historyEmitters)
	result.HistoryEventEmitters = historyEmitters
	result.HistoryStartBlock = s.StartBlock
	if tx.QueryRow(ctx, `SELECT hash FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND canonical AND events_verified`, s.ChainID, s.StartBlock).Scan(&result.HistoryStartHash) != nil {
		return fail()
	}
	result.TreasuryClaimHistoryVerified = true
	holderKeys := map[string]bool{}
	for _, holder := range result.HolderMarkets {
		if holder.Mode == "epoch" {
			holderKeys[holder.Distributor+":"+holder.MarketID] = true
		}
	}
	result.TreasuryClaims = []TreasuryClaimCandidate{}
	for _, claim := range claims.claimCandidates {
		if holderKeys[claim.Distributor+":"+claim.MarketID] {
			result.TreasuryClaims = append(result.TreasuryClaims, claim)
		}
	}
	result.ServiceCredits = claims.creditCandidates
	result.ServiceCreditHistoryVerified = true
	result.EmitterAddressBindingsVerified = emitters != nil
	result.ProtocolEventInventoryVerified = emitters != nil
	feeVault := ""
	if s.EmitterManifest != nil {
		for _, contract := range s.EmitterManifest.Contracts {
			if contract.Module == "ProtocolFeeVault" {
				if feeVault != "" {
					return fail()
				}
				feeVault = contract.Address
			}
		}
	}
	feeReport := buildFeeReconciliation(result, batch, feeVault, feeInputs)
	result.FeeReconciliation = &feeReport
	if tx.Commit(ctx) != nil {
		return fail()
	}
	return result, nil
}
