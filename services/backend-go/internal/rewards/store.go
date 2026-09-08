package rewards

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

var ErrUnavailable = errors.New("reward observations unavailable")
var ErrRevision = errors.New("reward revision changed; restart pagination")

type Source struct {
	ObservedClaimHistoryVerified bool   `json:"observedClaimHistoryVerified"`
	ReplayedInputCount           string `json:"replayedInputCount"`
	ChainID                      uint64 `json:"chainId"`
	BlockNumber                  string `json:"blockNumber"`
	BlockHash                    string `json:"blockHash"`
	Revision                     string `json:"revision"`
	Finality                     string `json:"finality"`
	HistoryComplete              bool   `json:"historyComplete"`
	PublicationEligible          bool   `json:"publicationEligible"`
}
type Result struct {
	Items  []deployment.StateObservation `json:"items"`
	Source Source                        `json:"source"`
}
type Reader interface {
	LoadRewards(context.Context, string, string) (Result, error)
}
type Store struct {
	cache   verifiedCache
	Pool    *pgxpool.Pool
	ChainID uint64
	Version string
	Scope   string
}

// LoadRewards reads only the current finalized projection revision. A changed
// revision invalidates pagination rather than mixing account states across blocks.
func (s *Store) LoadRewards(ctx context.Context, user, revision string) (Result, error) {
	fail := func() (Result, error) { return Result{}, ErrUnavailable }
	if s.Pool == nil || !address.MatchString(user) {
		return fail()
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return fail()
	}
	defer tx.Rollback(context.Background())
	var locked bool
	if e = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock_shared($1)", int64(730000000+s.ChainID)).Scan(&locked); e != nil || !locked {
		return fail()
	}
	var visibility string
	// Include server/database identity to avoid reuse across reconnect/failover
	// or database replacement. pg_snapshot uses full transaction IDs (xid8).
	if e = tx.QueryRow(ctx, `SELECT json_build_array(pg_current_snapshot()::text,pg_postmaster_start_time(),inet_server_addr(),inet_server_port(),pg_is_in_recovery(),current_user,(SELECT oid FROM pg_database WHERE datname=current_database()))::text`).Scan(&visibility); e != nil {
		return fail()
	}
	var height, start, inputCount uint64
	var blockTime *uint64
	var hash, digest, version, scope string
	var payload []byte
	var updated time.Time
	var expected, completed int
	e = tx.QueryRow(ctx, `SELECT b.block_timestamp,p.start_block,p.input_count,p.tip_number,p.tip_hash,p.projector_version,j.updated_at,o.scope,o.expected_count,o.completed_count,o.payload,o.digest
 FROM tickergarden.projection_checkpoints p
 JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.tip_hash AND b.number=p.tip_number
 JOIN tickergarden.chain_journal j ON j.chain_id=p.chain_id
 JOIN tickergarden.projection_observation_batches o ON o.chain_id=p.chain_id AND o.block_hash=p.tip_hash
 WHERE p.chain_id=$1 AND b.canonical AND b.receipts_verified AND p.tip_number<=j.finalized_number`, s.ChainID).Scan(&blockTime, &start, &inputCount, &height, &hash, &version, &updated, &scope, &expected, &completed, &payload, &digest)
	if e != nil || blockTime == nil || version != s.Version || scope != s.Scope || time.Since(updated) > 120*time.Second || time.Until(updated) > 5*time.Second || len(payload) > 16<<20 || deployment.Hash(payload) != digest {
		return fail()
	}
	current := strconv.FormatUint(height, 10) + ":" + hash
	if revision != "" && revision != current {
		return Result{}, ErrRevision
	}
	cacheKey := visibility + "|" + strconv.FormatUint(s.ChainID, 10) + "|" + version + "|" + scope + "|" + current + "|" + digest
	rows, cached := s.cache.get(cacheKey)
	if !cached {
		var batch deployment.ObservationBatch
		if json.Unmarshal(payload, &batch) != nil || batch.ChainID != s.ChainID || batch.BlockHash != hash || batch.BlockNumber != "0x"+strconv.FormatUint(height, 16) || batch.Scope != scope || batch.Expected != expected || completed != expected || len(batch.Observations) != completed {
			return fail()
		}
		for _, row := range batch.Observations {
			if (row.Kind == "creatorEpoch" || row.Kind == "gaugePosition") && text(row.Value, "observedAtTimestamp") != strconv.FormatUint(*blockTime, 10) {
				return fail()
			}
		}
		claims, e := verifyClaimHistory(ctx, tx, s.ChainID, start, height, inputCount, hash)
		if e != nil {
			return fail()
		}
		rows, e = VerifyPositionsAgainstClaims(batch.Observations, claims)
		if e != nil {
			return fail()
		}
	}
	result := Result{Items: []deployment.StateObservation{}, Source: Source{ChainID: s.ChainID, BlockNumber: strconv.FormatUint(height, 10), BlockHash: hash, Revision: current, Finality: "finalized", ObservedClaimHistoryVerified: true, ReplayedInputCount: strconv.FormatUint(inputCount, 10)}}
	for _, row := range rows {
		if row.Value["beneficiary"] == user {
			result.Items = append(result.Items, row)
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return fail()
	}
	if !cached {
		s.cache.put(cacheKey, rows)
	}
	return result, nil
}

// VerifyPositions recomputes unpaid amounts and exit state from the saved views.
// Observed claim totals are not an independent proof of full event history.
func VerifyPositions(observations []deployment.StateObservation) ([]deployment.StateObservation, error) {
	claims := []ClaimTotal{}
	saved := map[string]deployment.StateObservation{}
	for _, row := range observations {
		if row.Kind != "rewardPosition" {
			continue
		}
		if _, exists := saved[row.Key]; exists {
			return nil, ErrUnavailable
		}
		saved[row.Key] = row
		v := row.Value
		if text(v, "observedClaimCount") != "0" {
			claims = append(claims, ClaimTotal{MarketID: text(v, "marketId"), FeeAsset: text(v, "feeAsset"), Role: text(v, "beneficiaryType"), User: text(v, "beneficiary"), Epoch: text(v, "beneficiaryEpoch"), Amount: text(v, "observedClaimedAmount"), Count: text(v, "observedClaimCount"), First: text(v, "firstClaimEventKey")})
		}
	}
	return VerifyPositionsAgainstClaims(observations, claims)
}

func VerifyPositionsAgainstClaims(observations []deployment.StateObservation, claims []ClaimTotal) ([]deployment.StateObservation, error) {
	saved := map[string]deployment.StateObservation{}
	for _, row := range observations {
		if row.Kind == "rewardPosition" {
			if _, ok := saved[row.Key]; ok {
				return nil, ErrUnavailable
			}
			saved[row.Key] = row
		}
	}
	rebuilt, e := Build(observations, claims)
	if e != nil || len(rebuilt) != len(saved) {
		return nil, ErrUnavailable
	}
	for _, row := range rebuilt {
		if !reflect.DeepEqual(row, saved[row.Key]) {
			return nil, ErrUnavailable
		}
	}
	return rebuilt, nil
}
