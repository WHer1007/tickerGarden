package analytics

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"math/big"
	"sort"
	"strconv"
)

type DetailFee struct{ Recipient, Asset, AmountRaw string }
type DetailFeesResult struct {
	Fees     []DetailFee
	Coverage RangeCoverage
}

func (s *CandleStore) DetailTip(ctx context.Context) (uint64, string, string, error) {
	commitment, _, _, err := conversionManifest(s.manifest)
	if err != nil {
		return 0, "", "", err
	}
	var ts, n uint64
	var h string
	err = s.pool.QueryRow(ctx, `SELECT b.block_timestamp,b.number,b.hash FROM tickergarden.projection_checkpoints p JOIN tickergarden.chain_blocks b ON b.chain_id=p.chain_id AND b.hash=p.tip_hash AND b.number=p.tip_number JOIN tickergarden.chain_journal j ON j.chain_id=p.chain_id WHERE p.chain_id=$1 AND p.manifest_hash=$2 AND j.genesis_hash=$3 AND b.canonical AND b.receipts_verified AND b.number<=j.finalized_number`, s.manifest.ChainID, commitment, s.manifest.GenesisHash).Scan(&ts, &n, &h)
	return ts, strconv.FormatUint(n, 10), h, err
}

// DetailFees reports actual bucket credits, not claims or current liabilities.
// HolderAmounts have already been deducted from creatorAmount in emitted events;
// adding HolderFeesAccrued therefore does not double count creator revenue.
// Amounts remain separated by asset. Creator credits include creator tax.
func (s *CandleStore) DetailFees(ctx context.Context, market string, from, to uint64) (DetailFeesResult, error) {
	if !hashRE.MatchString(market) {
		return DetailFeesResult{}, ErrCoverage
	}
	_, vault, _, err := conversionManifest(s.manifest)
	if err != nil {
		return DetailFeesResult{}, err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return DetailFeesResult{}, err
	}
	defer tx.Rollback(context.Background())
	coverage, err := VerifyRangeCoverage(ctx, tx, s.manifest, from, to)
	if err != nil {
		return DetailFeesResult{}, err
	}
	rows, err := tx.Query(ctx, `SELECT e.payload->>'signature',e.payload->'args' FROM tickergarden.canonical_projection_rows e JOIN tickergarden.chain_blocks b ON b.chain_id=e.chain_id AND b.hash=e.block_hash WHERE e.chain_id=$1 AND e.table_name='events' AND e.payload->'provenance'->>'emitter'=$2 AND e.payload->'args'->>'marketId'=$3 AND b.canonical AND b.receipts_verified AND b.block_timestamp >= $4 AND b.block_timestamp < $5 AND e.payload->>'signature' IN ('CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256)','FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)','HolderFeesAccrued(bytes32,uint32,address,uint256)') LIMIT 100001`, s.manifest.ChainID, vault, market, from, to)
	if err != nil {
		return DetailFeesResult{}, err
	}
	defer rows.Close()
	sums := map[string]*big.Int{}
	count := 0
	for rows.Next() {
		count++
		if count > 100000 {
			return DetailFeesResult{}, ErrCoverage
		}
		var sig string
		var raw []byte
		if rows.Scan(&sig, &raw) != nil {
			return DetailFeesResult{}, ErrCoverage
		}
		var a map[string]any
		if json.Unmarshal(raw, &a) != nil {
			return DetailFeesResult{}, ErrCoverage
		}
		asset, _ := a["feeAsset"].(string)
		if asset == "" {
			asset, _ = a["quoteAsset"].(string)
		}
		if !addressRE.MatchString(asset) {
			return DetailFeesResult{}, ErrCoverage
		}
		fields := map[string]string{"creator": "creatorAmount", "stakers": "stakerAmount", "platform": "platformAmount"}
		if sig == "HolderFeesAccrued(bytes32,uint32,address,uint256)" {
			fields = map[string]string{"holders": "amount"}
		}
		for recipient, field := range fields {
			v, ok := a[field].(string)
			if !ok {
				if field == "stakerAmount" && sig == "CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256)" {
					continue
				}
				return DetailFeesResult{}, ErrCoverage
			}
			amount, e := uint256(v)
			if e != nil {
				return DetailFeesResult{}, e
			}
			key := recipient + ":" + asset
			if sums[key] == nil {
				sums[key] = new(big.Int)
			}
			sums[key].Add(sums[key], amount)
		}
	}
	if rows.Err() != nil {
		return DetailFeesResult{}, rows.Err()
	}
	rows.Close()
	out := []DetailFee{}
	for key, n := range sums {
		for i, c := range key {
			if c == ':' {
				out = append(out, DetailFee{key[:i], key[i+1:], n.String()})
				break
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Recipient+out[i].Asset < out[j].Recipient+out[j].Asset })
	if err = tx.Commit(ctx); err != nil {
		return DetailFeesResult{}, err
	}
	return DetailFeesResult{out, coverage}, nil
}

// DetailBlock resolves the timestamp for the exact canonical evidence checkpoint.
func (s *CandleStore) DetailBlock(ctx context.Context, number, hash string) (uint64, error) {
	var ts uint64
	err := s.pool.QueryRow(ctx, `SELECT block_timestamp FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND hash=$3 AND canonical AND receipts_verified`, s.manifest.ChainID, number, hash).Scan(&ts)
	return ts, err
}
