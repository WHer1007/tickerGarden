package demandevents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
	"time"
)

func (s *Service) worker() {
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-s.wake:
		}
		for s.ctx.Err() == nil {
			ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
			worked, retry, err := s.ProcessNext(ctx)
			cancel()
			if !worked {
				if retry || err != nil {
					time.AfterFunc(5*time.Second, func() {
						if s.ctx.Err() == nil {
							s.notify()
						}
					})
				}
				break
			}
		}
	}
}

// ProcessNext serializes a complete dependency scope, not individual event
// types. Different scopes use different leases and can run concurrently.
func (s *Service) ProcessNext(ctx context.Context) (bool, bool, error) {
	rows, err := s.Pool.Query(ctx, `SELECT j.scope_id FROM tickergarden.demand_event_jobs j WHERE j.state='pending' AND NOT EXISTS(SELECT 1 FROM tickergarden.demand_event_jobs earlier WHERE earlier.scope_id=j.scope_id AND earlier.from_block<j.from_block AND earlier.state<>'done') ORDER BY j.retry_at,j.scope_id LIMIT 64`)
	if err != nil {
		return false, false, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) != nil {
			rows.Close()
			return false, false, errors.New("invalid queue scope")
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return false, false, err
	}
	retry := false
	for _, id := range ids {
		tx, e := s.Pool.Begin(ctx)
		if e != nil {
			return false, false, e
		}
		var locked bool
		if e = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))`, "demand-process:"+id).Scan(&locked); e != nil || !locked {
			tx.Rollback(context.Background())
			if e != nil {
				return false, false, e
			}
			continue
		}
		var from uint64
		var raw, config []byte
		var state string
		var due bool
		e = tx.QueryRow(ctx, `SELECT from_block,logs,state,retry_at<=clock_timestamp() FROM tickergarden.demand_event_jobs WHERE scope_id=$1 AND state<>'done' ORDER BY from_block LIMIT 1 FOR UPDATE`, id).Scan(&from, &raw, &state, &due)
		if errors.Is(e, pgx.ErrNoRows) {
			tx.Rollback(context.Background())
			continue
		}
		if e != nil {
			tx.Rollback(context.Background())
			return false, false, e
		}
		if state == "failed" || !due {
			tx.Rollback(context.Background())
			retry = retry || state != "failed"
			continue
		}
		var scope Scope
		var logs []chainrpc.Log
		if tx.QueryRow(ctx, `SELECT config FROM tickergarden.demand_event_scopes WHERE scope_id=$1`, id).Scan(&config) != nil || json.Unmarshal(config, &scope) != nil || json.Unmarshal(raw, &logs) != nil {
			tx.Rollback(context.Background())
			return false, false, errors.New("invalid durable event job")
		}
		work, e := tx.Begin(ctx)
		if e != nil {
			tx.Rollback(context.Background())
			return false, false, e
		}
		e = s.Process(ctx, work, scope, logs)
		if e != nil {
			work.Rollback(context.Background())
			_, saveErr := tx.Exec(ctx, `UPDATE tickergarden.demand_event_jobs SET attempts=attempts+1,state=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'pending' END,retry_at=clock_timestamp()+interval '5 seconds',last_error='event_processing_failed' WHERE scope_id=$1 AND from_block=$2`, id, from)
			if saveErr != nil {
				tx.Rollback(context.Background())
				return false, false, saveErr
			}
			if saveErr = tx.Commit(ctx); saveErr != nil {
				return false, false, saveErr
			}
			return true, true, e
		}
		if e = work.Commit(ctx); e != nil {
			tx.Rollback(context.Background())
			return false, false, e
		}
		_, e = tx.Exec(ctx, `UPDATE tickergarden.demand_event_jobs SET state='done',last_error=NULL WHERE scope_id=$1 AND from_block=$2`, id, from)
		if e == nil {
			e = advance(ctx, tx, id)
		}
		if e != nil {
			tx.Rollback(context.Background())
			return false, false, e
		}
		if e = tx.Commit(ctx); e != nil {
			return false, false, e
		}
		return true, false, nil
	}
	return false, retry, nil
}

func (s *Service) decode(ctx context.Context, tx pgx.Tx, scope Scope, logs []chainrpc.Log) error {
	var previousBlock, previousIndex uint64
	for i, l := range logs {
		n, err := chainrpc.Quantity(l.BlockNumber)
		if err != nil {
			return err
		}
		index, err := chainrpc.Quantity(l.LogIndex)
		if err != nil {
			return err
		}
		ti, err := chainrpc.Quantity(l.TransactionIndex)
		if err != nil {
			return err
		}
		if i > 0 && (n < previousBlock || (n == previousBlock && index <= previousIndex)) {
			return errors.New("event queue is not ordered")
		}
		previousBlock, previousIndex = n, index
		module, ok := scope.Modules[l.Address]
		if !ok {
			return errors.New("event outside queue scope")
		}
		decoded, err := events.Decode(module, l)
		if err != nil {
			return err
		}
		payload, err := json.Marshal(struct {
			chainrpc.Log
			Event events.Decoded `json:"event"`
		}{l, decoded})
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO tickergarden.demand_event_records(scope_id,block_number,transaction_index,log_index,block_hash,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(scope_id,block_number,log_index) DO NOTHING`, scope.ID, n, ti, index, l.BlockHash, payload)
		if err != nil {
			return err
		}
		// Each market has one dependency queue containing all of its child modules.
		// Registration is local; child history is not queried until a page asks for it.
		if decoded.Signature == "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)" {
			id, ok := decoded.Args["marketId"].(string)
			if !ok {
				return errors.New("market ID missing")
			}
			child := Scope{ID: scope.ID + ":" + id, ChainID: scope.ChainID, Start: n, Modules: map[string]string{}}
			for field, kind := range map[string]string{"memeToken": "TickerMemeTokenV1", "curve": "TickerGardenCurve"} {
				a, ok := decoded.Args[field].(string)
				if ok && a != "0x0000000000000000000000000000000000000000" {
					child.Modules[a] = kind
				}
			}
			if len(child.Modules) < 2 {
				return fmt.Errorf("market child scope incomplete")
			}
			raw, _ := json.Marshal(child)
			_, err = tx.Exec(ctx, `INSERT INTO tickergarden.demand_event_scopes(scope_id,chain_id,config,start_block,read_through,processed_through) VALUES($1,$2,$3,$4::bigint,$4::bigint-1,$4::bigint-1) ON CONFLICT DO NOTHING`, child.ID, child.ChainID, raw, child.Start)
			if err != nil {
				return err
			}
		}
	}
	return nil
}
