package observationwork

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// QueueStatus describes all retained jobs in this database, across chains and
// releases. Counts are gauges, not lifetime counters or financial evidence.
// updated_at is attempt/update time, not the original enqueue timestamp.
type QueueStatus struct {
	Scope               string     `json:"scope"`
	ObservedAt          time.Time  `json:"observedAt"`
	Total               int64      `json:"total"`
	Pending             int64      `json:"pending"`
	Running             int64      `json:"running"`
	Complete            int64      `json:"complete"`
	RetryReady          int64      `json:"retryReady"`
	RetryDeferred       int64      `json:"retryDeferred"`
	ExpiredLeases       int64      `json:"expiredLeases"`
	RepeatedFailures    int64      `json:"repeatedFailures"`
	InvalidRows         int64      `json:"invalidRows"`
	OldestPendingUpdate *time.Time `json:"oldestPendingUpdate"`
	PendingAgeSeconds   *float64   `json:"pendingAgeSeconds"`
	Alerts              []string   `json:"alerts"`
	FinanciallyVerified bool       `json:"financiallyVerified"`
}

var ErrQueueStatus = errors.New("observation queue status unavailable")

// LoadQueueStatus is independent of the financial projector advisory lock.
// PostgreSQL MVCC gives one consistent observation without blocking job writers.
// No request/result bytes, wallet addresses or provider credentials are read.
func LoadQueueStatus(ctx context.Context, pool *pgxpool.Pool, maxAge time.Duration) (QueueStatus, error) {
	if pool == nil || maxAge <= 0 || maxAge > 24*time.Hour {
		return QueueStatus{}, ErrQueueStatus
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tx, e := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return QueueStatus{}, ErrQueueStatus
	}
	defer tx.Rollback(context.Background())
	s := QueueStatus{Scope: "database_all_retained_observation_jobs", Alerts: []string{}}
	e = tx.QueryRow(ctx, `SELECT transaction_timestamp(),count(*),
 count(*) FILTER (WHERE state='pending'),count(*) FILTER (WHERE state='running'),count(*) FILTER (WHERE state='complete'),
 count(*) FILTER (WHERE state='pending' AND retry_after<=transaction_timestamp()),
 count(*) FILTER (WHERE state='pending' AND retry_after>transaction_timestamp()),
 count(*) FILTER (WHERE state='running' AND lease_until<=transaction_timestamp()),
 count(*) FILTER (WHERE state='pending' AND attempts>=5),
 count(*) FILTER (WHERE state NOT IN ('pending','running','complete') OR attempts<0 OR generation<0 OR updated_at>transaction_timestamp() OR (state='running' AND lease_until IS NULL)),
 min(updated_at) FILTER (WHERE state='pending')
 FROM tickergarden.observation_work`).Scan(&s.ObservedAt, &s.Total, &s.Pending, &s.Running, &s.Complete, &s.RetryReady, &s.RetryDeferred, &s.ExpiredLeases, &s.RepeatedFailures, &s.InvalidRows, &s.OldestPendingUpdate)
	if e != nil {
		return QueueStatus{}, ErrQueueStatus
	}
	if e = tx.Commit(ctx); e != nil {
		return QueueStatus{}, ErrQueueStatus
	}
	return EvaluateQueueStatus(s, maxAge)
}

func EvaluateQueueStatus(s QueueStatus, maxAge time.Duration) (QueueStatus, error) {
	if s.Scope != "database_all_retained_observation_jobs" || s.ObservedAt.IsZero() || maxAge <= 0 || s.FinanciallyVerified {
		return QueueStatus{}, ErrQueueStatus
	}
	for _, n := range []int64{s.Total, s.Pending, s.Running, s.Complete, s.RetryReady, s.RetryDeferred, s.ExpiredLeases, s.RepeatedFailures, s.InvalidRows} {
		if n < 0 || n > s.Total {
			return QueueStatus{}, ErrQueueStatus
		}
	}
	// Subtract to avoid overflow on untrusted counts.
	if s.Total-s.Pending-s.Running != s.Complete || s.Pending-s.RetryReady != s.RetryDeferred || s.ExpiredLeases > s.Running || s.RepeatedFailures > s.Pending || (s.Pending == 0) != (s.OldestPendingUpdate == nil) {
		return QueueStatus{}, ErrQueueStatus
	}
	s.Alerts = []string{}
	s.PendingAgeSeconds = nil
	if s.OldestPendingUpdate != nil {
		age := s.ObservedAt.Sub(*s.OldestPendingUpdate).Seconds()
		if age < 0 {
			s.Alerts = append(s.Alerts, "future_update")
		} else {
			s.PendingAgeSeconds = &age
			if age > maxAge.Seconds() {
				s.Alerts = append(s.Alerts, "pending_stalled")
			}
		}
	}
	if s.ExpiredLeases > 0 {
		s.Alerts = append(s.Alerts, "lease_expired")
	}
	if s.RepeatedFailures > 0 {
		s.Alerts = append(s.Alerts, "repeated_failure")
	}
	if s.InvalidRows > 0 {
		s.Alerts = append(s.Alerts, "invalid_row")
	}
	return s, nil
}
