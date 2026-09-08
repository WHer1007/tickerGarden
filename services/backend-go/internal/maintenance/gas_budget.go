package maintenance

import (
	"context"
	"errors"
	"math/big"

	"github.com/jackc/pgx/v5"
)

var ErrBudgetRequired = errors.New("maintenance gas budget must be configured")
var ErrBudgetExceeded = errors.New("maintenance gas budget exceeded")

type GasBudget struct {
	ChainID        uint64 `json:"chainId"`
	GenesisHash    string `json:"genesisHash"`
	Sender         string `json:"sender"`
	Revision       int64  `json:"revision"`
	MaxTransaction string `json:"maxTransaction"`
	MaximumTotal   string `json:"maximumTotal"`
	Allocated      string `json:"allocated"`
}

func budgetNumber(s string) (*big.Int, bool) {
	if len(s) > 78 || !feeDecimal.MatchString(s) {
		return nil, false
	}
	n, ok := new(big.Int).SetString(s, 10)
	return n, ok && n.Sign() >= 0 && n.BitLen() <= 256
}
func budgetScope(genesis, sender string) bool {
	return leaseHash.MatchString(genesis) && discoveryAddress.MatchString(sender) && sender != "0x0000000000000000000000000000000000000000"
}
func (s Store) GasBudget(ctx context.Context, genesis, sender string) (GasBudget, error) {
	if s.Pool == nil || !budgetScope(genesis, sender) {
		return GasBudget{}, ErrUnavailable
	}
	b := GasBudget{ChainID: s.ChainID, GenesisHash: genesis, Sender: sender}
	e := s.Pool.QueryRow(ctx, `SELECT revision,max_transaction::text,maximum_total::text,allocated::text FROM tickergarden.maintenance_gas_budgets WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3`, s.ChainID, genesis, sender).Scan(&b.Revision, &b.MaxTransaction, &b.MaximumTotal, &b.Allocated)
	if errors.Is(e, pgx.ErrNoRows) {
		return b, ErrBudgetRequired
	}
	if e != nil {
		return b, ErrUnavailable
	}
	return b, nil
}

// SetGasBudget changes future admission limits without resetting any allocation.
// Retrying a request ID returns its original audit snapshot, not current limits.
func (s Store) SetGasBudget(ctx context.Context, genesis, sender, maxTransaction, maximumTotal, requestID string) (GasBudget, error) {
	max, ok := budgetNumber(maxTransaction)
	total, tok := budgetNumber(maximumTotal)
	if s.Pool == nil || !budgetScope(genesis, sender) || !leaseHash.MatchString(requestID) || requestID == "0x0000000000000000000000000000000000000000000000000000000000000000" || !ok || !tok || max.Sign() == 0 || total.Sign() == 0 || max.Cmp(total) > 0 {
		return GasBudget{}, ErrUnavailable
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return GasBudget{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_gas_budgets(chain_id,genesis_hash,sender,max_transaction,maximum_total) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, s.ChainID, genesis, sender, maxTransaction, maximumTotal); e != nil {
		return GasBudget{}, ErrUnavailable
	}
	b := GasBudget{ChainID: s.ChainID, GenesisHash: genesis, Sender: sender}
	if e = tx.QueryRow(ctx, `SELECT revision,max_transaction::text,maximum_total::text,allocated::text FROM tickergarden.maintenance_gas_budgets WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3 FOR UPDATE`, s.ChainID, genesis, sender).Scan(&b.Revision, &b.MaxTransaction, &b.MaximumTotal, &b.Allocated); e != nil {
		return b, ErrUnavailable
	}
	old := b
	e = tx.QueryRow(ctx, `SELECT revision,max_transaction::text,maximum_total::text,allocated::text FROM tickergarden.maintenance_gas_budget_changes WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3 AND request_id=$4`, s.ChainID, genesis, sender, requestID).Scan(&old.Revision, &old.MaxTransaction, &old.MaximumTotal, &old.Allocated)
	if e == nil {
		if old.MaxTransaction != maxTransaction || old.MaximumTotal != maximumTotal || tx.Commit(ctx) != nil {
			return GasBudget{}, ErrUnavailable
		}
		return old, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return b, ErrUnavailable
	}
	used, ok := budgetNumber(b.Allocated)
	if !ok || used.Cmp(total) > 0 {
		return b, ErrBudgetExceeded
	}
	if b.Revision == 1<<63-1 {
		return b, ErrUnavailable
	}
	b.Revision++
	b.MaxTransaction = maxTransaction
	b.MaximumTotal = maximumTotal
	if _, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_gas_budgets SET revision=$4,max_transaction=$5,maximum_total=$6 WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3`, s.ChainID, genesis, sender, b.Revision, maxTransaction, maximumTotal); e != nil {
		return b, ErrUnavailable
	}
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_gas_budget_changes(chain_id,genesis_hash,sender,request_id,revision,max_transaction,maximum_total,allocated) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, s.ChainID, genesis, sender, requestID, b.Revision, maxTransaction, maximumTotal, b.Allocated); e != nil || tx.Commit(ctx) != nil {
		return GasBudget{}, ErrUnavailable
	}
	return b, nil
}

// chargeGasBudgetIn shares the submission transaction and therefore cannot
// allocate budget without its outbox, or send a transaction without allocation.
func (s Store) chargeGasBudgetIn(ctx context.Context, tx pgx.Tx, in IntentRecord) error {
	r := in.Intent.Reservation
	var revision int64
	var maximum, total, allocated string
	e := tx.QueryRow(ctx, `SELECT revision,max_transaction::text,maximum_total::text,allocated::text FROM tickergarden.maintenance_gas_budgets WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3 FOR UPDATE`, s.ChainID, r.GenesisHash, r.Sender).Scan(&revision, &maximum, &total, &allocated)
	if errors.Is(e, pgx.ErrNoRows) {
		return ErrBudgetRequired
	}
	if e != nil || revision < 1 {
		return ErrUnavailable
	}
	max, mok := budgetNumber(maximum)
	cap, cok := budgetNumber(total)
	used, uok := budgetNumber(allocated)
	cost, kok := budgetNumber(in.Intent.MaximumGasCost)
	if !mok || !cok || !uok || !kok || cost.Sign() == 0 {
		return ErrUnavailable
	}
	next := new(big.Int).Add(used, cost)
	if cost.Cmp(max) > 0 || next.Cmp(cap) > 0 {
		return ErrBudgetExceeded
	}
	if _, e = tx.Exec(ctx, `UPDATE tickergarden.maintenance_gas_budgets SET allocated=$4 WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3`, s.ChainID, r.GenesisHash, r.Sender, next.String()); e != nil {
		return ErrUnavailable
	}
	if _, e = tx.Exec(ctx, `INSERT INTO tickergarden.maintenance_gas_budget_charges(job_key,chain_id,genesis_hash,sender,revision,maximum_gas_cost) VALUES($1,$2,$3,$4,$5,$6)`, r.JobKey, s.ChainID, r.GenesisHash, r.Sender, revision, cost.String()); e != nil {
		return ErrUnavailable
	}
	return nil
}
