package projector

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"reflect"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/principal"
	"tickergarden/backend/internal/projection"
)

type principalCheckpoint struct {
	Chain     uint64          `json:"chain"`
	BlockHash string          `json:"blockHash"`
	Manifest  string          `json:"manifest"`
	Version   string          `json:"version"`
	Start     uint64          `json:"start"`
	Inputs    uint64          `json:"inputs"`
	Ledger    json.RawMessage `json:"ledger"`
}

// Resume an immutable canonical checkpoint and apply all inputs through this block.
// The caller holds the chain lease; input coverage remains distinct from history proof.
func principalObservations(ctx context.Context, tx pgx.Tx, chain, next, start uint64, blockHash string, priorHash *string, manifest string, priorInputs uint64, observations []deployment.StateObservation) ([]deployment.StateObservation, error) {

	ledger := principal.New()
	from := start
	if priorHash != nil {
		var raw []byte
		var digest string
		var priorNumber uint64
		e := tx.QueryRow(ctx, `SELECT p.payload,p.digest,b.number FROM tickergarden.principal_checkpoints p JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.block_hash WHERE p.chain_id=$1 AND p.block_hash=$2 AND b.number<$3 AND b.canonical AND b.events_verified`, chain, *priorHash, next).Scan(&raw, &digest, &priorNumber)
		if e != nil {
			return nil, errors.New("principal parent checkpoint unavailable")
		}
		if priorNumber < start {
			return nil, errors.New("principal parent precedes scope")
		}
		from = priorNumber + 1
		sum := sha256.Sum256(raw)
		var cp principalCheckpoint
		if hex.EncodeToString(sum[:]) != digest || json.Unmarshal(raw, &cp) != nil || cp.Chain != chain || cp.BlockHash != *priorHash || cp.Manifest != manifest || cp.Version != Version || cp.Start != start || cp.Inputs != priorInputs {
			return nil, errors.New("principal checkpoint scope or integrity mismatch")
		}
		ledger, e = principal.Restore(cp.Ledger)
		if e != nil {
			return nil, e
		}
	} else if next != start || priorInputs != 0 {
		return nil, errors.New("principal initial range mismatch")
	}
	rows, e := tx.Query(ctx, `SELECT p.payload,p.digest,l.payload FROM tickergarden.projection_inputs p JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.block_hash JOIN tickergarden.chain_logs l ON l.chain_id=p.chain_id AND l.block_hash=p.block_hash AND l.log_index=p.log_index WHERE p.chain_id=$1 AND b.canonical AND b.events_verified AND b.number BETWEEN $2 AND $3 ORDER BY b.number,p.log_index LIMIT 100001`, chain, from, next)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	count, bytes := 0, 0
	for rows.Next() {
		var data, source []byte
		var digest string
		var input projection.Input
		var log chainrpc.Log
		if e = rows.Scan(&data, &digest, &source); e != nil {
			return nil, e
		}
		count++
		bytes += len(data) + len(source)
		if count > 100000 || bytes > 64<<20 {
			return nil, errors.New("principal replay budget exceeded")
		}
		if deployment.Hash(data) != digest || json.Unmarshal(data, &input) != nil || json.Unmarshal(source, &log) != nil || input.ChainID != chain || !reflect.DeepEqual(input.Log, log) {
			return nil, errors.New("principal replay source mismatch")
		}
		decoded, e := events.Decode(input.Module, input.Log)
		if e != nil {
			return nil, e
		}
		if e = ledger.Apply(decoded); e != nil {
			return nil, e
		}
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	var expected int
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM tickergarden.projection_inputs p JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.block_hash WHERE p.chain_id=$1 AND b.canonical AND b.events_verified AND b.number BETWEEN $2 AND $3`, chain, from, next).Scan(&expected); e != nil {
		return nil, e
	}
	if count != expected {
		return nil, errors.New("principal replay input coverage mismatch")
	}

	snapshot, e := ledger.Snapshot()
	if e != nil {
		return nil, e
	}
	payload, e := json.Marshal(principalCheckpoint{Chain: chain, BlockHash: blockHash, Manifest: manifest, Version: Version, Start: start, Inputs: priorInputs + uint64(count), Ledger: snapshot})
	if e != nil {
		return nil, e
	}
	sum := sha256.Sum256(payload)
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.principal_checkpoints(chain_id,block_hash,parent_hash,payload,digest) VALUES($1,$2,$3,$4,$5)`, chain, blockHash, priorHash, payload, hex.EncodeToString(sum[:])); e != nil {
		return nil, e
	}
	report := ledger.Reconcile(observations)
	reportPayload, e := json.Marshal(report)
	if e != nil {
		return nil, e
	}
	reportDigest := sha256.Sum256(reportPayload)
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.reconciliation_runs(chain_id,block_hash,scope,expected_count,completed_count,failed_count,missing_count,payload,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, chain, blockHash, report.Scope, report.Expected, report.Completed, report.Failed, report.Missing, reportPayload, hex.EncodeToString(reportDigest[:])); e != nil {
		return nil, e
	}
	for i, probe := range report.Probes {
		if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.reconciliation_probes(chain_id,block_hash,scope,ordinal,kind,probe_key,field,expected_value,actual_value,status,comparison) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, chain, blockHash, report.Scope, i, probe.Kind, probe.Key, probe.Field, probe.Expected, probe.Actual, probe.Status, probe.Comparison); e != nil {
			return nil, e
		}
	}
	views := map[string]map[string]any{}
	for _, o := range observations {
		views[o.Kind+":"+o.Key] = o.Value
	}
	out := []deployment.StateObservation{}
	for _, a := range ledger.Accounts() {
		key := a.AssetUID + ":" + a.User
		view, ok := views["vaultPosition:"+key]
		out = append(out, deployment.StateObservation{Kind: "principalAccount", Key: key, Value: map[string]any{"eventBalance": a, "viewPresent": ok, "checks": map[string]bool{"depositedMatches": ok && view["deposited"] == a.Deposited, "allocatedMatches": ok && view["allocated"] == a.Allocated, "freeMatches": ok && view["freeBalanceOf"] == a.Free}, "historyComplete": false}})
	}
	for _, a := range ledger.Allocations() {
		key := a.AssetUID + ":" + a.User + ":" + a.MarketID
		view, ok := views["vaultAllocation:"+key]
		out = append(out, deployment.StateObservation{Kind: "principalAllocation", Key: key, Value: map[string]any{"eventBalance": a, "viewPresent": ok, "checks": map[string]bool{"allocationMatches": ok && view["allocation"] == a.Amount}, "historyComplete": false}})
	}
	return out, nil
}
