package maintenance

import (
	"context"
	"tickergarden/backend/internal/deployment"
)

type Preparation struct {
	Lease  Lease        `json:"lease"`
	Record IntentRecord `json:"record"`
}

// Prepare atomically stores the simulation, lease, nonce and exact unsigned
// intent. A failed exact simulation rolls back the nonce allocation as well as
// the lease. This API cannot sign or submit transactions.
func (s Store) Prepare(ctx context.Context, rpc IntentObserver, p deployment.MaintenancePreview, fees Fees, owner, token string, ttl int) (Preparation, error) {
	if s.Pool == nil || rpc == nil || deployment.ValidateMaintenancePreview(p) != nil || p.ChainID != s.ChainID || !validLeaseInput(p.Key, owner, token, ttl) {
		return Preparation{}, ErrUnavailable
	}
	// Reject invalid fee bounds before acquiring locks or touching nonce state.
	if _, _, e := intentCall(p, Reservation{Nonce: "0"}, fees); e != nil {
		return Preparation{}, e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Preparation{}, ErrUnavailable
	}
	defer tx.Rollback(ctx)
	if _, e = s.recordIn(ctx, tx, p); e != nil {
		return Preparation{}, e
	}
	l, e := s.acquireLeaseIn(ctx, tx, p.Key, owner, token, ttl)
	if e != nil {
		return Preparation{}, e
	}
	if _, e = s.reserveNonceIn(ctx, tx, rpc, p, owner, token, l.Generation); e != nil {
		return Preparation{}, e
	}
	in, e := s.prepareIntentIn(ctx, tx, rpc, p, fees, owner, token, l.Generation)
	if e != nil {
		return Preparation{}, e
	}
	if tx.Commit(ctx) != nil {
		return Preparation{}, ErrUnavailable
	}
	return Preparation{Lease: l, Record: in}, nil
}
