package maintenance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"

	"tickergarden/backend/internal/deployment"
)

var discoveryAddress = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

type DiscoveryRPC interface {
	PoststateRPC
	deployment.MaintenanceObserver
}
type DiscoveryResult struct {
	Status     string                          `json:"status"`
	ScopeKey   string                          `json:"scopeKey"`
	JobKey     string                          `json:"jobKey,omitempty"`
	Generation int64                           `json:"generation"`
	State      deployment.MaintenancePoststate `json:"state"`
}

// DiscoverWork tests one explicit market/operation scope and atomically records a
// simulated job only when work is needed. The caller supplies no trigger or target.
func (s Store) DiscoverWork(ctx context.Context, rpc DiscoveryRPC, m deployment.Manifest, from string, request deployment.MaintenanceRequest) (DiscoveryResult, error) {
	if s.Pool == nil || rpc == nil || m.ChainID != s.ChainID || request.TriggerID != "" || !discoveryAddress.MatchString(from) || from == "0x0000000000000000000000000000000000000000" {
		return DiscoveryResult{}, ErrUnavailable
	}
	// The scope includes sender and chain incarnation, but not changing block data.
	scope := struct {
		Version           string
		ChainID           uint64
		GenesisHash, From string
		Request           deployment.MaintenanceRequest
	}{"maintenance-work-v1", m.ChainID, m.GenesisHash, from, request}
	body, e := json.Marshal(scope)
	if e != nil {
		return DiscoveryResult{}, ErrUnavailable
	}
	key := deployment.Hash(body)
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return DiscoveryResult{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_work_scopes(scope_key,scope_payload) VALUES($1,$2) ON CONFLICT DO NOTHING`, key, body)
	if e != nil {
		return DiscoveryResult{}, ErrUnavailable
	}
	var stored []byte
	var generation int64
	var active *string
	e = tx.QueryRow(ctx, `SELECT scope_payload,generation,active_job_key FROM tickergarden.maintenance_work_scopes WHERE scope_key=$1 FOR UPDATE`, key).Scan(&stored, &generation, &active)
	if e != nil || !bytes.Equal(stored, body) || generation == 1<<63-1 {
		return DiscoveryResult{}, ErrUnavailable
	}

	if active != nil {
		if e = s.lockLeaseJob(ctx, tx, *active); e != nil {
			return DiscoveryResult{}, e
		}
		var identityRaw []byte
		var identityValue identity
		if e = tx.QueryRow(ctx, `SELECT identity_payload FROM tickergarden.maintenance_jobs WHERE job_key=$1`, *active).Scan(&identityRaw); e != nil || json.Unmarshal(identityRaw, &identityValue) != nil {
			return DiscoveryResult{}, ErrUnavailable
		}
		expectedRequest := request
		expectedRequest.TriggerID = deployment.Hash([]byte(key + ":" + strconv.FormatInt(generation, 10)))
		if identityValue.Request != expectedRequest || identityValue.From != from || identityValue.ChainID != m.ChainID || identityValue.GenesisHash != m.GenesisHash {
			return DiscoveryResult{}, ErrUnavailable
		}
	}
	// A stable next-generation trigger allows uncertain transaction commits to be
	// retried without inventing another logical job.
	probeGeneration := generation
	if probeGeneration == 0 {
		probeGeneration = 1
	}
	request.TriggerID = deployment.Hash([]byte(key + ":" + strconv.FormatInt(probeGeneration, 10)))
	block, e := rpc.Header(ctx, "latest")
	if e != nil {
		return DiscoveryResult{}, ErrUnavailable
	}
	state, e := deployment.ObserveMaintenancePoststate(ctx, rpc, m, block, request, "")
	if e != nil {
		return DiscoveryResult{}, e
	}

	now, e := leaseNow(ctx, tx)
	timestamp, te := block.Time()
	if e != nil || te != nil || timestamp > uint64(now.Unix()+5) || now.Unix()-int64(timestamp) > 120 {
		return DiscoveryResult{}, ErrUnavailable
	}
	result := DiscoveryResult{Status: "not_needed", ScopeKey: key, Generation: generation, State: state}
	if active != nil {
		result.JobKey = *active
	}
	if !state.Satisfied {
		if active != nil {
			// A previous scope generation remains the sole job until fresh receipt and
			// block-end evidence prove completion. Signing delays never create duplicates.
			// Release the scope/job locks and connection before nested verification.
			// Recheck the scope generation after verification to detect another planner.
			if e = tx.Rollback(ctx); e != nil {
				return DiscoveryResult{}, ErrUnavailable
			}
			verified, e := s.VerifyPoststate(ctx, rpc, m, *active)
			if e != nil || !verified.Evidence.State.Satisfied {
				result.Status = "awaiting_existing"
				return result, nil
			}
			tx, e = s.Pool.Begin(ctx)
			if e != nil {
				return DiscoveryResult{}, ErrUnavailable
			}
			defer tx.Rollback(ctx)
			var currentGeneration int64
			var currentActive *string
			var currentBody []byte
			e = tx.QueryRow(ctx, `SELECT generation,active_job_key,scope_payload FROM tickergarden.maintenance_work_scopes WHERE scope_key=$1 FOR UPDATE`, key).Scan(&currentGeneration, &currentActive, &currentBody)
			if e != nil || currentGeneration != generation || currentActive == nil || *currentActive != *active || !bytes.Equal(currentBody, body) {
				return DiscoveryResult{}, ErrUnavailable
			}
		}
		request.TriggerID = deployment.Hash([]byte(key + ":" + strconv.FormatInt(generation+1, 10)))
		preview, e := deployment.PreviewMaintenance(ctx, rpc, m, block, from, request)
		if e != nil {
			return DiscoveryResult{}, e
		}
		if preview.To != state.Target {
			return DiscoveryResult{}, errors.New("maintenance target changed during discovery")
		}
		if _, e = s.recordIn(ctx, tx, preview); e != nil {
			return DiscoveryResult{}, e
		}
		generation++
		_, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_work_scopes SET generation=$2,active_job_key=$3 WHERE scope_key=$1`, key, generation, preview.Key)
		if e != nil {
			return DiscoveryResult{}, ErrUnavailable
		}
		result.State.Request = preview.Request
		result.Status = "prepared"
		result.JobKey = preview.Key
		result.Generation = generation
	}
	if tx.Commit(ctx) != nil {
		return DiscoveryResult{}, ErrUnavailable
	}
	return result, nil
}
