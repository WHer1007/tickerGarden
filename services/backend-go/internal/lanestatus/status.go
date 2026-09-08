// Package lanestatus reports read-only ingestion and activity coverage health.
// It is deliberately independent of financial readiness or publication gates.
package lanestatus

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/useractivity"
)

var ErrUnavailable = errors.New("lane status unavailable")

const eventVersion = "event-facts-v1"

var manifestPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

type Config struct {
	ChainID          int64
	StartBlock       int64
	ManifestHash     string
	ProjectorVersion string
}

type Status struct {
	SchemaVersion       string    `json:"schemaVersion"`
	Scope               string    `json:"scope"`
	ChainID             int64     `json:"chainId"`
	StartBlock          int64     `json:"startBlock"`
	FinalizedBlock      int64     `json:"finalizedBlock"`
	JournalThrough      int64     `json:"journalThrough"`
	EventThrough        int64     `json:"eventThrough"`
	UserActivityThrough int64     `json:"userActivityThrough"`
	FirstGap            *int64    `json:"firstGap,omitempty"`
	ManifestHash        string    `json:"manifestHash"`
	ProjectorVersion    string    `json:"projectorVersion"`
	ObservedAt          time.Time `json:"observedAt"`
	Available           bool      `json:"available"`
	Alerts              []string  `json:"alerts"`
}

// Load takes one repeatable-read snapshot. Activity coverage is bounded by the
// configured start and the journal's finalized checkpoint; MAX(block) is never
// used as a proxy for completeness.
func Load(ctx context.Context, pool *pgxpool.Pool, c Config) (Status, error) {
	if pool == nil || c.ChainID <= 0 || c.StartBlock < 0 || !manifestPattern.MatchString(c.ManifestHash) || c.ProjectorVersion != eventVersion {
		return Status{}, ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Status{}, ErrUnavailable
	}
	defer tx.Rollback(context.Background())
	s := Status{SchemaVersion: "lane-status-v1", Scope: "event_activity", ChainID: c.ChainID, StartBlock: c.StartBlock, ManifestHash: c.ManifestHash, ProjectorVersion: c.ProjectorVersion, Alerts: []string{}}
	var finalized int64
	if err = tx.QueryRow(ctx, `SELECT finalized_number FROM tickergarden.chain_journal WHERE chain_id=$1 AND finalized_number IS NOT NULL`, c.ChainID).Scan(&finalized); err != nil {
		return Status{}, ErrUnavailable
	}
	s.FinalizedBlock = finalized
	var finalizedHash string
	if err = tx.QueryRow(ctx, `SELECT j.finalized_hash FROM tickergarden.chain_journal j JOIN tickergarden.chain_blocks b ON b.chain_id=j.chain_id AND b.number=j.finalized_number AND b.hash=j.finalized_hash WHERE j.chain_id=$1 AND b.canonical AND b.receipts_verified`, c.ChainID).Scan(&finalizedHash); err != nil {
		return Status{}, ErrUnavailable
	}
	if finalized < c.StartBlock {
		return Status{}, ErrUnavailable
	}
	var cpStart int64
	var tip sql.NullInt64
	var mh, ver string
	if err = tx.QueryRow(ctx, `SELECT start_block,tip_number,manifest_hash,projector_version FROM tickergarden.event_projection_checkpoints WHERE chain_id=$1`, c.ChainID).Scan(&cpStart, &tip, &mh, &ver); err != nil || cpStart != c.StartBlock || mh != c.ManifestHash || ver != c.ProjectorVersion {
		return Status{}, ErrUnavailable
	}
	if !tip.Valid || tip.Int64 > finalized {
		return Status{}, ErrUnavailable
	}
	var tipHash string
	if err = tx.QueryRow(ctx, `SELECT p.tip_hash FROM tickergarden.event_projection_checkpoints p JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.number=p.tip_number AND b.hash=p.tip_hash WHERE p.chain_id=$1 AND b.canonical AND b.receipts_verified`, c.ChainID).Scan(&tipHash); err != nil {
		return Status{}, ErrUnavailable
	}
	// First missing/non-canonical/unverified block from the configured start.
	var gap *int64
	err = tx.QueryRow(ctx, `SELECT min(x.n) FROM generate_series($2::bigint,$3::bigint) x(n) LEFT JOIN tickergarden.chain_blocks b ON b.chain_id=$1 AND b.number=x.n AND b.canonical AND b.receipts_verified WHERE b.number IS NULL`, c.ChainID, c.StartBlock, finalized).Scan(&gap)
	if err != nil {
		return Status{}, ErrUnavailable
	}
	s.FirstGap = gap
	if gap == nil {
		s.JournalThrough = finalized
	} else if *gap > c.StartBlock {
		s.JournalThrough = *gap - 1
	} else {
		s.JournalThrough = c.StartBlock - 1
	}
	if err = tx.QueryRow(ctx, `SELECT transaction_timestamp()`).Scan(&s.ObservedAt); err != nil {
		return Status{}, ErrUnavailable
	}
	s.Available = gap == nil && tip.Valid && tip.Int64 == finalized
	if gap != nil {
		s.Alerts = append(s.Alerts, "activity_gap")
	}
	if !tip.Valid || tip.Int64 < finalized {
		s.Alerts = append(s.Alerts, "projection_behind_finalized")
	}
	var activityGap *int64
	if err = tx.QueryRow(ctx, `SELECT min(x.n) FROM generate_series($2::bigint,$3::bigint) x(n) LEFT JOIN tickergarden.chain_blocks b ON b.chain_id=$1 AND b.number=x.n AND b.canonical AND b.receipts_verified LEFT JOIN tickergarden.user_activity_blocks a ON a.chain_id=b.chain_id AND a.block_hash=b.hash AND a.manifest_hash=$4 AND a.extractor_version=$5 AND a.receipt_set_hash=b.receipt_set_hash WHERE b.number IS NULL OR a.block_hash IS NULL`, c.ChainID, c.StartBlock, finalized, c.ManifestHash, useractivity.Version).Scan(&activityGap); err != nil {
		return Status{}, ErrUnavailable
	}
	if activityGap == nil {
		s.UserActivityThrough = finalized
	} else {
		s.UserActivityThrough = *activityGap - 1
		s.Alerts = append(s.Alerts, "user_activity_gap")
	}
	s.EventThrough = s.JournalThrough
	if tip.Valid && tip.Int64 < s.EventThrough {
		s.EventThrough = tip.Int64
	}
	s.Available = s.Available && activityGap == nil
	if err = tx.Commit(ctx); err != nil {
		return Status{}, ErrUnavailable
	}
	return s, nil
}
