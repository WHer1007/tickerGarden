package projector

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/rewards"
)

func rewardObservations(ctx context.Context, tx pgx.Tx, chain uint64, observations []deployment.StateObservation) ([]deployment.StateObservation, error) {
	rows, err := tx.Query(ctx, `SELECT row_key,payload FROM tickergarden.projection_rows WHERE chain_id=$1 AND table_name='feeClaimTotals' ORDER BY row_key LIMIT 100001`, chain)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	claims := []rewards.ClaimTotal{}
	for rows.Next() {
		if len(claims) >= 100000 {
			return nil, errors.New("reward claim observation budget exceeded")
		}
		var key string
		var raw []byte
		if err = rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		var envelope struct {
			Key    string             `json:"key"`
			Values rewards.ClaimTotal `json:"values"`
		}
		if err = json.Unmarshal(raw, &envelope); err != nil {
			return nil, err
		}
		c := envelope.Values
		expected := c.MarketID + ":" + c.FeeAsset + ":" + c.Role + ":" + c.User + ":" + c.Epoch
		if key != envelope.Key || key != expected {
			return nil, errors.New("reward claim identity mismatch")
		}
		claims = append(claims, c)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return rewards.Build(observations, claims)
}
