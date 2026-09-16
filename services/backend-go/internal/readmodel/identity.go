package readmodel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/marketidentity"
)

func identityView(m MarketReadModel, observed deployment.MarketIdentity) (*MarketIdentityReadModel, error) {
	if observed.MemeToken != m.MemeToken {
		return nil, errors.New("snapshot token differs from identity")
	}
	number, e := chainrpc.Quantity(observed.BlockNumber)
	if e != nil {
		return nil, e
	}
	return &MarketIdentityReadModel{Name: observed.Name, Symbol: observed.Symbol, MetadataURI: observed.MetadataURI, DeployedAt: observed.DeployedAt, BlockNumber: fmt.Sprint(number), BlockHash: observed.BlockHash, RuntimeCodeHash: observed.RuntimeCodeHash}, nil
}
func verifyIdentities(ctx context.Context, q marketidentity.BatchQueryer, s Snapshot) error {
	ids := []string{}
	for _, m := range s.Markets {
		if m.Identity != nil {
			ids = append(ids, m.MarketID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	if s.Sync.BlockHash == nil {
		return errors.New("identity requires snapshot block hash")
	}
	identities, err := marketidentity.LoadManyAt(ctx, q, s.Sync.ChainID, ids, *s.Sync.BlockHash)
	if err != nil {
		return err
	}
	for _, m := range s.Markets {
		if m.Identity == nil {
			continue
		}
		stored, e := identityView(m, identities[m.MarketID])
		if e != nil || !reflect.DeepEqual(stored, m.Identity) {
			return errors.New("snapshot identity differs from canonical observation")
		}
	}
	return nil
}

// EnrichIdentities adds a complete identity catalog under the chain lease.
// Publish independently rechecks it under its own lease before committing.
func (s *Store) EnrichIdentities(ctx context.Context, data []byte) ([]byte, error) {
	snap, e := Parse(data, s.ChainID)
	if e != nil {
		return nil, e
	}
	if snap.Sync.BlockHash == nil {
		return nil, errors.New("identity enrichment requires snapshot block hash")
	}
	if s.Pool == nil {
		return nil, errors.New("identity enrichment requires PostgreSQL")
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared($1)`, int64(730000000+s.ChainID)); e != nil {
		return nil, e
	}
	ids := make([]string, 0, len(snap.Markets))
	for _, m := range snap.Markets {
		ids = append(ids, m.MarketID)
	}
	identities, e := marketidentity.LoadManyAt(ctx, tx, s.ChainID, ids, *snap.Sync.BlockHash)
	if e != nil {
		return nil, e
	}
	for i, m := range snap.Markets {
		identity, e := identityView(m, identities[m.MarketID])
		if e != nil {
			return nil, e
		}
		if m.Identity != nil && !reflect.DeepEqual(m.Identity, identity) {
			return nil, errors.New("input identity mismatch")
		}
		snap.Markets[i].Identity = identity
	}
	raw, e := json.Marshal(snap)
	if e != nil {
		return nil, e
	}
	if _, e = Parse(raw, s.ChainID); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return raw, nil
}
