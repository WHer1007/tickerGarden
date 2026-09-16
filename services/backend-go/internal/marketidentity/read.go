package marketidentity

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
)

var ErrUnavailable = errors.New("market identity unavailable for snapshot")
var hashRE = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var addressRE = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

// LoadAt returns an identity only if its creation is at or before the requested
// canonical finalized journal block. Consumers must pass their snapshot hash.
type Queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func LoadAt(ctx context.Context, pool Queryer, chain uint64, market, asOfHash string) (deployment.MarketIdentity, error) {
	if !hashRE.MatchString(market) || !hashRE.MatchString(asOfHash) || pool == nil {
		return deployment.MarketIdentity{}, ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var raw []byte
	var digest, blockHash, token string
	var number uint64
	var timestamp *uint64
	e := pool.QueryRow(ctx, `SELECT i.payload,i.digest,i.block_hash,b.number,b.block_timestamp,d.payload->'state'->>'memeToken'
 FROM tickergarden.canonical_market_identities i
 JOIN tickergarden.chain_blocks b ON b.chain_id=i.chain_id AND b.hash=i.block_hash
 JOIN tickergarden.canonical_discovered_markets d ON d.chain_id=i.chain_id AND d.block_hash=i.block_hash AND d.market_id=i.market_id
 JOIN tickergarden.chain_blocks anchor ON anchor.chain_id=i.chain_id AND anchor.hash=$3
 JOIN tickergarden.chain_journal j ON j.chain_id=i.chain_id
 WHERE i.chain_id=$1 AND i.market_id=$2 AND anchor.canonical AND anchor.receipts_verified AND b.number<=anchor.number AND anchor.number<=j.finalized_number`, chain, market, asOfHash).Scan(&raw, &digest, &blockHash, &number, &timestamp, &token)
	if errors.Is(e, pgx.ErrNoRows) {
		return deployment.MarketIdentity{}, ErrUnavailable
	}
	if e != nil {
		return deployment.MarketIdentity{}, e
	}
	return decodeIdentity(raw, digest, blockHash, number, timestamp, token, chain, market)
}

func decodeIdentity(raw []byte, digest, blockHash string, number uint64, timestamp *uint64, token string, chain uint64, market string) (deployment.MarketIdentity, error) {
	sum := sha256.Sum256(raw)
	var identity deployment.MarketIdentity
	if timestamp == nil || hex.EncodeToString(sum[:]) != digest || json.Unmarshal(raw, &identity) != nil || identity.ChainID != chain || identity.MarketID != market || identity.BlockHash != blockHash || identity.BlockNumber != fmt.Sprintf("0x%x", number) || identity.MemeToken != token || !addressRE.MatchString(token) || !hashRE.MatchString(identity.RuntimeCodeHash) || identity.DeployedAt != fmt.Sprint(*timestamp) || len(identity.Name) > 4096 || len(identity.Symbol) > 4096 || len(identity.MetadataURI) > 16384 || !utf8.ValidString(identity.Name+identity.Symbol+identity.MetadataURI) {
		return deployment.MarketIdentity{}, errors.New("market identity integrity mismatch")
	}
	return identity, nil
}
