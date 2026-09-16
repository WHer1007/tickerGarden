package readmodel

import (
	"context"
	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/journal"
)

func (s *ObservationStore) verifyCandidateHistory(ctx context.Context, tx pgx.Tx, end uint64, endHash string) (bool, error) {
	return journal.VerifyStoredReceiptHistory(ctx, tx, s.ChainID, s.StartBlock, end, s.GenesisHash, endHash)
}
