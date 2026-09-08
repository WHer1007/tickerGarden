package projector

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
)

// Canonical projection facts retain requests even after epoch reset.
func historicalServiceAssets(ctx context.Context, tx pgx.Tx, chain uint64) ([]deployment.ServiceAssetTarget, error) {
	rows, err := tx.Query(ctx, `SELECT DISTINCT r.payload->'provenance'->>'emitter',r.payload->'args'->>'serviceFeeAsset' FROM tickergarden.projection_rows r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE r.chain_id=$1 AND b.canonical AND b.events_verified AND r.table_name='events' AND r.payload->>'signature'='RootRequested(bytes32,uint32,address,uint64,uint64,uint64,bytes32,uint256,address,uint128,uint64)' LIMIT 4097`, chain)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []deployment.ServiceAssetTarget{}
	for rows.Next() {
		var target deployment.ServiceAssetTarget
		if err := rows.Scan(&target.Distributor, &target.Asset); err != nil {
			return nil, err
		}
		out = append(out, target)
		if len(out) > deployment.MaxHistoricalServiceAssets {
			return nil, errors.New("historical service asset budget exceeded")
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
