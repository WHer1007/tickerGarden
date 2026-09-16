package demandevents

import (
	"context"
	"strconv"
	"tickergarden/backend/internal/eventfeed"
	"time"
)

func (s *Service) read(ctx context.Context, scope Scope, limit int) (eventfeed.Feed, error) {
	out := eventfeed.Feed{ChainID: scope.ChainID, Scope: scope.ID, DisplayOnly: true, FinanciallyVerified: false, Events: []eventfeed.Event{}}
	var read, processed, start uint64
	var head, timestamp *uint64
	var hash *string
	var at *time.Time
	err := s.Pool.QueryRow(ctx, `SELECT start_block,read_through,processed_through,head_number,head_hash,head_timestamp,observed_at FROM tickergarden.demand_event_scopes WHERE scope_id=$1`, scope.ID).Scan(&start, &read, &processed, &head, &hash, &timestamp, &at)
	if err != nil {
		return out, err
	}
	out.HistoryFrom = strconv.FormatUint(start, 10)
	out.Finality = "finalized"
	if s.Default.FromHead {
		out.Finality = "head"
	}
	out.IndexedThrough = strconv.FormatUint(processed, 10)
	out.ObservedThrough = strconv.FormatUint(read, 10)
	if head == nil && scope.FromHead && read == scope.Start-1 {
		out.HistoryFrom = ""
		out.IndexedThrough = ""
		out.ObservedThrough = ""
	}
	out.Stale = true
	out.Processing = head == nil || processed < read
	if at != nil {
		out.SourceObservedAt = *at
	}
	if head != nil && hash != nil && timestamp != nil && at != nil {
		if !s.Default.FromHead {
			out.FinalizedThrough = strconv.FormatUint(*head, 10)
		}
		out.BlockHash = *hash
		if *head >= processed {
			out.LagBlocks = strconv.FormatUint(*head-processed, 10)
		}
		out.Stale = time.Since(*at) > 30*time.Second || time.Since(*at) < -5*time.Second || time.Since(time.Unix(int64(*timestamp), 0)) > 30*time.Second || time.Since(time.Unix(int64(*timestamp), 0)) < -5*time.Second || read < *head || processed < read
	}
	rows, err := s.Pool.Query(ctx, `SELECT block_number,log_index,block_hash,payload FROM tickergarden.demand_event_records WHERE scope_id=$1 AND block_number<=$2 ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT $3`, scope.ID, processed, limit)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var event eventfeed.Event
		var n, index uint64
		if err = rows.Scan(&n, &index, &event.BlockHash, &event.Payload); err != nil {
			return out, err
		}
		event.BlockNumber = strconv.FormatUint(n, 10)
		event.Key = event.BlockHash + ":" + strconv.FormatUint(index, 10)
		out.Events = append(out.Events, event)
	}
	return out, rows.Err()
}
