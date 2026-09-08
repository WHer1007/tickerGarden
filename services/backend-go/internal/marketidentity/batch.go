package marketidentity

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
	"time"
)

type BatchQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

// LoadManyAt validates an entire requested identity set in one SQL statement.
// No partial catalog escapes if any item is missing, duplicated or corrupt.
// SQL retains the canonical identity/discovery view predicates without joining
// those nested views repeatedly for every member of the set. The materialized
// anchor evaluates the shared finalized/discovery constraints once in the same
// statement snapshot; per-market canonicality and identity checks remain live.
func LoadManyAt(ctx context.Context, q BatchQueryer, chain uint64, markets []string, asOfHash string) (map[string]deployment.MarketIdentity, error) {
	if q == nil || !hashRE.MatchString(asOfHash) || len(markets) > 50000 {
		return nil, ErrUnavailable
	}
	wanted := make(map[string]bool, len(markets))
	for _, id := range markets {
		if !hashRE.MatchString(id) || wanted[id] {
			return nil, ErrUnavailable
		}
		wanted[id] = true
	}
	out := make(map[string]deployment.MarketIdentity, len(markets))
	if len(markets) == 0 {
		return out, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	rows, err := q.Query(ctx, `WITH identity_anchor AS MATERIALIZED (
 SELECT checkpoint.manifest_hash,anchor.number
 FROM tickergarden.discovery_checkpoints checkpoint
 JOIN tickergarden.chain_journal j ON j.chain_id=checkpoint.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=checkpoint.chain_id AND tip.hash=checkpoint.tip_hash
 JOIN tickergarden.chain_blocks anchor ON anchor.chain_id=checkpoint.chain_id AND anchor.hash=$3
 WHERE checkpoint.chain_id=$1
 AND tip.canonical AND tip.receipts_verified AND tip.number=checkpoint.tip_number AND tip.number<=j.finalized_number
 AND anchor.canonical AND anchor.receipts_verified AND anchor.number<=j.finalized_number
 )
 SELECT i.market_id,i.payload,i.digest,i.block_hash,b.number,b.block_timestamp,d.payload->'state'->>'memeToken'
 FROM identity_anchor anchor
 JOIN tickergarden.market_identities i ON i.chain_id=$1 AND i.manifest_hash=anchor.manifest_hash
 JOIN tickergarden.chain_blocks b ON b.chain_id=i.chain_id AND b.hash=i.block_hash
 JOIN tickergarden.discovered_markets d ON d.chain_id=i.chain_id AND d.block_hash=i.block_hash AND d.market_id=i.market_id
 WHERE i.market_id=ANY($2::text[]) AND b.canonical AND b.receipts_verified AND b.number<=anchor.number LIMIT $4`, chain, markets, asOfHash, len(markets)+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bytes := 0
	for rows.Next() {
		var id, digest, blockHash, token string
		var raw []byte
		var number uint64
		var timestamp *uint64
		if err = rows.Scan(&id, &raw, &digest, &blockHash, &number, &timestamp, &token); err != nil {
			return nil, err
		}
		bytes += len(raw)
		if bytes > 64<<20 || !wanted[id] {
			return nil, errors.New("market identity batch exceeds scope or budget")
		}
		if _, exists := out[id]; exists {
			return nil, errors.New("duplicate canonical market identity")
		}
		identity, e := decodeIdentity(raw, digest, blockHash, number, timestamp, token, chain, id)
		if e != nil {
			return nil, e
		}
		out[id] = identity
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if len(out) != len(wanted) {
		return nil, ErrUnavailable
	}
	return out, nil
}
