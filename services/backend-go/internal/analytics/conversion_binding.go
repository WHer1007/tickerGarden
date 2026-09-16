package analytics

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
)

func conversionManifest(m deployment.Manifest) (string, string, string, error) {
	m.Contracts = append([]deployment.Contract{}, m.Contracts...)
	sort.Slice(m.Contracts, func(i, j int) bool { return m.Contracts[i].Address < m.Contracts[j].Address })
	raw, err := json.Marshal(m)
	if err != nil {
		return "", "", "", ErrConversionLink
	}
	if _, err = deployment.Parse(raw); err != nil {
		return "", "", "", ErrConversionLink
	}
	vault, manager := "", ""
	for _, c := range m.Contracts {
		switch c.Module {
		case "ProtocolFeeVault":
			if vault != "" {
				return "", "", "", ErrConversionLink
			}
			vault = c.Address
		case "UniswapV4PoolManager":
			if manager != "" {
				return "", "", "", ErrConversionLink
			}
			manager = c.Address
		}
	}
	if vault == "" || manager == "" {
		return "", "", "", ErrConversionLink
	}
	return deployment.Hash(raw), vault, manager, nil
}

func loadConversionBindings(ctx context.Context, tx pgx.Tx, chain uint64, receipt chainrpc.Receipt, vault, manager string) ([]ConversionBinding, error) {
	pools, markets := []string{}, []string{}
	for _, l := range receipt.Logs {
		module := ""
		if l.Address == vault {
			module = "ProtocolFeeVault"
		}
		if l.Address == manager {
			module = "UniswapV4PoolManager"
		}
		if module == "" {
			continue
		}
		e, err := events.Decode(module, l)
		if err == events.ErrUnknown {
			continue
		}
		if err != nil {
			return nil, ErrConversionLink
		}
		if e.Signature == "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)" {
			id, _ := e.Args["id"].(string)
			pools = append(pools, id)
		}
		if a, err := NormalizeConversionSummary(e); err == nil {
			markets = append(markets, a.MarketID)
		} else if err != ErrNotConversionSummary {
			return nil, ErrConversionLink
		}
	}
	rows, err := tx.Query(ctx, `SELECT m.row_key,m.payload->'values'->>'poolId',m.payload->'values'->>'memeToken',m.payload->'values'->>'quoteAsset',m.payload->'values'->>'graduatedHook',q.payload->'values'->>'quoteDecimals',k.payload->'values'
 FROM tickergarden.canonical_projection_rows m
 JOIN tickergarden.canonical_projection_rows k ON k.chain_id=m.chain_id AND k.table_name='pools' AND k.row_key=m.row_key AND k.payload->>'key'=m.row_key
 JOIN tickergarden.canonical_projection_rows q ON q.chain_id=m.chain_id AND q.table_name='configs' AND q.row_key='quote:'||(m.payload->'values'->>'quoteAssetConfigId')
 WHERE m.chain_id=$1 AND m.table_name='markets' AND m.payload->>'marketId'=m.row_key
 AND (m.row_key=ANY($2::text[]) OR m.payload->'values'->>'poolId'=ANY($3::text[]))
 AND q.payload->>'kind'='quote' AND q.payload->>'id'=m.payload->'values'->>'quoteAssetConfigId'
 AND q.payload->'values'->>'quoteAsset'=m.payload->'values'->>'quoteAsset'
 AND octet_length(k.payload::text)<=65536 LIMIT 1025`, chain, markets, pools)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ConversionBinding{}
	for rows.Next() {
		var market, pool, meme, quote, hook, decimals string
		var raw []byte
		if rows.Scan(&market, &pool, &meme, &quote, &hook, &decimals, &raw) != nil || len(result) >= 1024 {
			return nil, ErrConversionLink
		}
		b, err := resolvePoolBinding(raw, market, pool, meme, quote, decimals, hook)
		if err != nil {
			return nil, err
		}
		result = append(result, ConversionBinding{Pool: b, Hook: hook, FeeVault: vault, PoolManager: manager})
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
