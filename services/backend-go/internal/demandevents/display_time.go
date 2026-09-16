package demandevents

import (
	"context"
	"errors"
	"fmt"
)

// Cached by hash, so an orphaned block can never supply time for its replacement.
func (s *Service) eventTime(ctx context.Context, n uint64, hash string) (uint64, error) {
	var at uint64
	if s.Pool.QueryRow(ctx, `SELECT block_time FROM tickergarden.display_block_times WHERE chain_id=$1 AND block_hash=$2 AND block_number=$3`, s.Default.ChainID, hash, n).Scan(&at) == nil {
		return at, nil
	}
	h, err := s.Source.Header(ctx, fmt.Sprintf("0x%x", n))
	if err != nil || h.Hash != hash {
		return 0, errors.New("event block mismatch")
	}
	at, err = h.Time()
	if err != nil {
		return 0, err
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO tickergarden.display_block_times VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, s.Default.ChainID, hash, n, at)
	return at, err
}
