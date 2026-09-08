package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
)

type MarketHolders struct {
	MarketID            string `json:"marketId"`
	MemeToken           string `json:"memeToken"`
	CreationBlockNumber string `json:"creationBlockNumber"`
	SourceBlockNumber   string `json:"sourceBlockNumber"`
	SourceBlockHash     string `json:"sourceBlockHash"`
	Finality            string `json:"finality"`
	ExclusionPolicy     string `json:"exclusionPolicy"`
	HolderBalances
}

// LoadMarketHolders reconstructs the complete registered token history through
// the finalized projection checkpoint. Counts are addresses, not verified users.
func LoadMarketHolders(ctx context.Context, pool *pgxpool.Pool, m deployment.Manifest, market string) (MarketHolders, error) {
	if pool == nil {
		return MarketHolders{}, ErrHolders
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return MarketHolders{}, err
	}
	defer tx.Rollback(context.Background())
	out, err := loadMarketHolders(ctx, tx, m, market)
	if err != nil {
		return MarketHolders{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MarketHolders{}, err
	}
	return out, nil
}

func loadMarketHolders(ctx context.Context, tx pgx.Tx, m deployment.Manifest, market string) (MarketHolders, error) {
	fail := func() (MarketHolders, error) { return MarketHolders{}, ErrHolders }
	if tx == nil || !hashRE.MatchString(market) {
		return fail()
	}
	commitment, vault, manager, err := conversionManifest(m)
	if err != nil {
		return fail()
	}
	factory, treasury := "", ""
	for _, c := range m.Contracts {
		switch c.Module {
		case "TickerGardenFactoryV1":
			if factory != "" {
				return fail()
			}
			factory = c.Address
		case "TreasuryDistributorV1":
			if treasury != "" {
				return fail()
			}
			treasury = c.Address
		}
	}
	if factory == "" || treasury == "" {
		return fail()
	}
	var first, last, index uint64
	var creationHash, sourceHash string
	var raw []byte
	var count int
	err = tx.QueryRow(ctx, `SELECT b.number,d.block_hash,d.log_index,d.payload,p.tip_number,p.tip_hash,count(*) OVER ()
 FROM tickergarden.canonical_discovered_markets d
 JOIN tickergarden.chain_blocks b ON b.chain_id=d.chain_id AND b.hash=d.block_hash
 JOIN tickergarden.discovery_checkpoints c ON c.chain_id=d.chain_id
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=d.chain_id
 JOIN tickergarden.chain_journal j ON j.chain_id=d.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash AND tip.number=p.tip_number
 WHERE d.chain_id=$1 AND d.market_id=$2 AND c.manifest_hash=$3 AND p.manifest_hash=$3 AND j.genesis_hash=$4
 AND c.start_block=p.start_block AND p.start_block<=b.number AND b.number<=p.tip_number AND p.tip_number<=c.tip_number AND p.tip_number<=j.finalized_number
 AND tip.canonical AND tip.receipts_verified AND octet_length(d.payload::text)<=1048576`, m.ChainID, market, commitment, m.GenesisHash).Scan(&first, &creationHash, &index, &raw, &last, &sourceHash, &count)
	if err != nil || count != 1 {
		return fail()
	}
	var discovered deployment.MarketDiscovery
	if json.Unmarshal(raw, &discovered) != nil {
		return fail()
	}
	var rawLog, rawReceipt []byte
	err = tx.QueryRow(ctx, `SELECT l.payload,r.payload FROM tickergarden.chain_logs l JOIN tickergarden.chain_receipts r ON r.chain_id=l.chain_id AND r.block_hash=l.block_hash AND r.transaction_hash=l.payload->>'transactionHash' WHERE l.chain_id=$1 AND l.block_hash=$2 AND l.log_index=$3 AND r.status='0x1' AND octet_length(r.payload::text)<=33554432`, m.ChainID, creationHash, index).Scan(&rawLog, &rawReceipt)
	var created chainrpc.Log
	var receipt chainrpc.Receipt
	if err != nil || json.Unmarshal(rawLog, &created) != nil || json.Unmarshal(rawReceipt, &receipt) != nil || !reflect.DeepEqual(created, discovered.Source) || created.Address != factory || created.BlockHash != creationHash || created.BlockNumber != fmt.Sprintf("0x%x", first) || created.LogIndex != fmt.Sprintf("0x%x", index) || created.Removed || discovered.MarketID != market {
		return fail()
	}
	found := false
	for _, l := range receipt.Logs {
		if reflect.DeepEqual(l, created) {
			found = true
		}
	}
	if !found {
		return fail()
	}
	event, err := events.Decode("TickerGardenFactoryV1", created)
	asset, assetOK := discovered.State["assetUid"].(string)
	token, a := discovered.State["memeToken"].(string)
	curve, b := discovered.State["curve"].(string)
	zero := "0x" + strings.Repeat("0", 40)
	if !assetOK || !hashRE.MatchString(asset) || event.Args["assetUid"] != asset || err != nil || event.Signature != "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)" || !a || !b || !addressRE.MatchString(token) || !addressRE.MatchString(curve) || token == zero || curve == zero || token == curve || event.Args["marketId"] != market || event.Args["memeToken"] != token || event.Args["curve"] != curve {
		return fail()
	}
	// Discovery must retain both authenticated runtime observations.
	tokenSeen, curveSeen := false, false
	for _, c := range discovered.Contracts {
		if !hashRE.MatchString(c.RuntimeCodeHash) {
			return fail()
		}
		if c.Address == token && c.Module == "TickerMemeTokenV1" {
			tokenSeen = true
		}
		if c.Address == curve && c.Module == "TickerGardenCurve" {
			curveSeen = true
		}
	}
	if !tokenSeen || !curveSeen {
		return fail()
	}
	transfers, err := ReadCommittedTransferRange(ctx, tx, m.ChainID, token, first, last)
	if err != nil || len(transfers) == 0 {
		return fail()
	}
	mint := transfers[0]
	if mint.From != zero || mint.To != curve || mint.Source.BlockHash != creationHash || mint.Source.TransactionHash != created.TransactionHash || mint.Source.LogIndex >= index {
		return fail()
	}
	excluded := map[string]bool{curve: true, treasury: true, vault: true, manager: true, factory: true, token: true}
	for _, key := range []string{"gauge", "graduatedHook"} {
		address, ok := discovered.State[key].(string)
		if !ok || !addressRE.MatchString(address) {
			return fail()
		}
		if address != zero {
			excluded[address] = true
		}
	}
	exclusions := []string{}
	for address := range excluded {
		exclusions = append(exclusions, address)
	}
	balances, err := RebuildHolderBalances(m.ChainID, token, curve, treasury, mint.Value, transfers, exclusions)
	if err != nil {
		return fail()
	}
	return MarketHolders{market, token, strconv.FormatUint(first, 10), strconv.FormatUint(last, 10), sourceHash, "finalized", "KNOWN_PROTOCOL_ADDRESSES_V1", balances}, nil
}
