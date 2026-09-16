// Package txaccount separates transaction-sending roles on a chain/account.
package txaccount

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
)

var ErrRole = errors.New("transaction account role unavailable or conflicting")

// Claim holds the account-role row until the surrounding transaction ends.
func Claim(ctx context.Context, tx pgx.Tx, chain uint64, genesis, sender, role string) error {
	if role != "maintenance" && role != "settlement" {
		return ErrRole
	}
	_, err := tx.Exec(ctx, `INSERT INTO tickergarden.transaction_account_roles(chain_id,genesis_hash,sender,role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, chain, genesis, sender, role)
	if err != nil {
		return ErrRole
	}
	var saved string
	if tx.QueryRow(ctx, `SELECT role FROM tickergarden.transaction_account_roles WHERE chain_id=$1 AND genesis_hash=$2 AND sender=$3 FOR UPDATE`, chain, genesis, sender).Scan(&saved) != nil || saved != role {
		return ErrRole
	}
	return nil
}
