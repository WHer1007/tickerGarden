package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

// LoadConversionLinks reads a complete successful receipt and authenticated
// projection inputs in one repeatable-read snapshot. The configured manifest
// must match the persisted projection/discovery scope; market bindings are resolved here.
func LoadConversionLinks(ctx context.Context, pool *pgxpool.Pool, manifest deployment.Manifest, transaction string) ([]ConversionLink, error) {
	if pool == nil || !hashRE.MatchString(transaction) {
		return nil, ErrConversionLink
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background())
	out, err := loadConversionLinks(ctx, tx, manifest, transaction)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}
func loadConversionLinks(ctx context.Context, tx pgx.Tx, manifest deployment.Manifest, transaction string) ([]ConversionLink, error) {
	commitment, vault, manager, err := conversionManifest(manifest)
	if err != nil {
		return nil, err
	}
	chain := manifest.ChainID
	var raw []byte
	var block string
	var number, index uint64
	err = tx.QueryRow(ctx, `SELECT r.payload,r.block_hash,b.number,r.transaction_index FROM tickergarden.chain_receipts r
 JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=r.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=r.chain_id
 JOIN tickergarden.discovery_checkpoints d ON d.chain_id=r.chain_id
 WHERE p.manifest_hash=$3 AND d.manifest_hash=$3 AND j.genesis_hash=$4 AND d.start_block=p.start_block AND r.chain_id=$1 AND r.transaction_hash=$2 AND r.status='0x1' AND b.canonical AND b.receipts_verified
 AND tip.canonical AND tip.receipts_verified AND b.number BETWEEN p.start_block AND p.tip_number AND p.tip_number<=j.finalized_number
 AND octet_length(r.payload::text)<=16777216`, chain, transaction, commitment, manifest.GenesisHash).Scan(&raw, &block, &number, &index)
	if err != nil {
		return nil, ErrConversionLink
	}
	var receipt chainrpc.Receipt
	if json.Unmarshal(raw, &receipt) != nil || receipt.Status != "0x1" || receipt.BlockHash != block || receipt.TransactionHash != transaction || receipt.BlockNumber != fmt.Sprintf("0x%x", number) || receipt.TransactionIndex != fmt.Sprintf("0x%x", index) || receipt.Logs == nil || len(receipt.Logs) > 10000 {
		return nil, ErrConversionLink
	}
	bindings, err := loadConversionBindings(ctx, tx, chain, receipt, vault, manager)
	if err != nil {
		return nil, err
	}
	modules := map[string]string{vault: "ProtocolFeeVault", manager: "UniswapV4PoolManager"}
	for _, b := range bindings {
		for _, entry := range [][2]string{{b.Hook, "TickerGardenMemeHook"}, {b.FeeVault, "ProtocolFeeVault"}, {b.PoolManager, "UniswapV4PoolManager"}} {
			addr, module := entry[0], entry[1]
			if old, ok := modules[addr]; ok && old != module {
				return nil, ErrConversionLink
			}
			modules[addr] = module
		}
	}
	// Fetch all inputs for this receipt's block once; filter by receipt indices in
	// SQL to avoid a query per log and bound returned payloads before decoding.
	indices := make([]int64, 0, len(receipt.Logs))
	var previous uint64
	for i, l := range receipt.Logs {
		n, e := strconv.ParseUint(l.LogIndex, 0, 63)
		if e != nil || l.LogIndex != fmt.Sprintf("0x%x", n) || (i > 0 && n <= previous) || l.Removed || l.BlockHash != block || l.BlockNumber != receipt.BlockNumber || l.TransactionHash != transaction || l.TransactionIndex != receipt.TransactionIndex {
			return nil, ErrConversionLink
		}
		previous = n
		indices = append(indices, int64(n))
	}
	rows, err := tx.Query(ctx, `SELECT log_index,payload,digest FROM tickergarden.projection_inputs WHERE chain_id=$1 AND block_hash=$2 AND log_index=ANY($3::bigint[]) ORDER BY log_index`, chain, block, indices)
	if err != nil {
		return nil, err
	}
	inputs := map[int64]projection.Input{}
	total := 0
	for rows.Next() {
		var n int64
		var data []byte
		var digest string
		if rows.Scan(&n, &data, &digest) != nil {
			rows.Close()
			return nil, ErrConversionLink
		}
		total += len(data)
		var in projection.Input
		if total > 16777216 || crypto.Keccak256Hash(data).Hex() != digest || json.Unmarshal(data, &in) != nil || in.ChainID != chain {
			rows.Close()
			return nil, ErrConversionLink
		}
		inputs[n] = in
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	logs := []ConversionLog{}
	for i, l := range receipt.Logs {
		in, found := inputs[indices[i]]
		module, required := modules[l.Address]
		if !found {
			if required {
				if _, e := events.Decode(module, l); e != events.ErrUnknown {
					return nil, ErrConversionLink
				}
			}
			continue
		}
		if !reflect.DeepEqual(in.Log, l) || (required && in.Module != module) {
			return nil, ErrConversionLink
		}
		e, err := events.Decode(in.Module, l)
		if err != nil {
			return nil, ErrConversionLink
		}
		source := CurveSource{ChainID: chain, BlockNumber: strconv.FormatUint(number, 10), BlockHash: block, TransactionHash: transaction, TransactionIndex: index, LogIndex: uint64(indices[i]), Emitter: l.Address, EventKey: fmt.Sprintf("%d:%s:%d", chain, transaction, indices[i])}
		logs = append(logs, ConversionLog{Source: source, Event: e})
	}
	out, err := LinkConversionSwaps(logs, bindings)
	if err != nil {
		return nil, err
	}
	return out, nil
}
