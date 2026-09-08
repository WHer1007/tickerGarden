package projector

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
	"tickergarden/backend/internal/rewards"
)

func conversionObservations(ctx context.Context, tx pgx.Tx, chain uint64, blockHash string, observations []deployment.StateObservation) ([]deployment.StateObservation, error) {
	rows, e := tx.Query(ctx, `SELECT payload,digest FROM tickergarden.projection_inputs WHERE chain_id=$1 AND block_hash=$2 ORDER BY log_index LIMIT 100001`, chain, blockHash)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	inputs := []projection.Input{}
	size := 0
	for rows.Next() {
		var raw []byte
		var digest string
		if e = rows.Scan(&raw, &digest); e != nil {
			return nil, e
		}
		size += len(raw)
		if len(inputs) >= 100000 || size > 64<<20 || deployment.Hash(raw) != digest {
			return nil, errors.New("invalid conversion input evidence")
		}
		var input projection.Input
		if e = json.Unmarshal(raw, &input); e != nil {
			return nil, e
		}
		if input.ChainID != chain || input.Log.BlockHash != blockHash {
			return nil, errors.New("conversion input block mismatch")
		}
		inputs = append(inputs, input)
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	return rewards.ConversionBatches(inputs, observations)
}
