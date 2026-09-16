package treasury

import (
	"context"
	"encoding/json"
	"errors"
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

const MaxHistoryBlocks uint64 = 1_000_000
const MaxHistoryTransfers = 100_000
const MaxHistoryPayloadBytes = 64 << 20

type JournalEvidence struct {
	ChainID             uint64 `json:"chainId"`
	ManifestHash        string `json:"discoveryManifestHash"`
	CreationBlock       uint64 `json:"creationBlock"`
	SourceBlock         uint64 `json:"sourceBlock"`
	SourceHash          string `json:"sourceHash"`
	BlockCount          uint64 `json:"blockCount"`
	TransferCount       int    `json:"transferCount"`
	InitialMint         string `json:"initialMint"`
	JournalRangeChecked bool   `json:"journalRangeChecked"`
	ReceiptRootVerified bool   `json:"receiptRootVerified"`
	RootRequestVerified bool   `json:"rootRequestVerified"`
}
type historyBlock struct {
	number, time         uint64
	hash, parent         string
	root, rootCommitment *string
	receiptCount         *int
}

// LoadJournalInput reads an immutable database snapshot under the chain's shared
// advisory lock. It verifies range/discovery/receipt-row consistency, not an
// independent consensus or the caller's claimed RootRequested context. Stored
// receipt-root evidence is checked against every receipt in the complete range.
func LoadJournalInput(ctx context.Context, pool *pgxpool.Pool, in Input) (Input, JournalEvidence, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Input{}, JournalEvidence{}, errors.New("cannot open Treasury journal snapshot")
	}
	defer tx.Rollback(ctx)
	loaded, evidence, err := loadJournalInputTx(ctx, tx, in)
	if err != nil {
		return Input{}, JournalEvidence{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Input{}, JournalEvidence{}, errors.New("cannot close Treasury journal snapshot")
	}
	return loaded, evidence, nil
}

// Reuse the caller's snapshot when checking a persisted artifact.
func loadJournalInputTx(ctx context.Context, tx pgx.Tx, in Input) (Input, JournalEvidence, error) {
	fail := func(e error) (Input, JournalEvidence, error) { return Input{}, JournalEvidence{}, e }
	if len(in.Transfers) != 0 {
		return fail(errors.New("journal mode requires an empty Transfer input"))
	}
	c := normalizedContext(in.Context)
	if e := validateContext(c); e != nil {
		return fail(e)
	}
	chain, e := strconv.ParseUint(c.ChainID, 10, 63)
	if e != nil || (chain != 4663 && chain != 46630 && chain != 421614) {
		return fail(errors.New("unsupported journal chain"))
	}
	source, e := strconv.ParseUint(c.SourceBlockNumber, 10, 63)
	if e != nil {
		return fail(errors.New("unsupported journal source"))
	}
	var locked bool
	if e = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock_shared($1)`, int64(730000000+chain)).Scan(&locked); e != nil || !locked {
		return fail(errors.New("Treasury journal snapshot busy"))
	}
	var finalized uint64
	var finalHash string
	e = tx.QueryRow(ctx, `SELECT j.finalized_number,j.finalized_hash FROM tickergarden.chain_journal j JOIN tickergarden.chain_blocks b ON b.chain_id=j.chain_id AND b.number=j.finalized_number AND b.hash=j.finalized_hash AND b.canonical AND b.receipts_verified WHERE j.chain_id=$1`, chain).Scan(&finalized, &finalHash)
	if e != nil || source > finalized {
		return fail(errors.New("Treasury source not finalized in journal"))
	}
	var creation uint64
	var payload []byte
	var creationHash, manifestHash string
	var creationIndex uint64
	e = tx.QueryRow(ctx, `SELECT b.number,m.block_hash,m.log_index,m.payload,d.manifest_hash FROM tickergarden.canonical_discovered_markets m JOIN tickergarden.chain_blocks b ON b.chain_id=m.chain_id AND b.hash=m.block_hash JOIN tickergarden.discovery_checkpoints d ON d.chain_id=m.chain_id JOIN tickergarden.chain_blocks tip ON tip.chain_id=d.chain_id AND tip.hash=d.tip_hash AND tip.number=d.tip_number AND tip.canonical AND tip.receipts_verified WHERE m.chain_id=$1 AND m.market_id=$2 AND d.start_block<=b.number AND d.tip_number>=$3`, chain, c.MarketID, source).Scan(&creation, &creationHash, &creationIndex, &payload, &manifestHash)
	if e != nil {
		return fail(errors.New("canonical market discovery coverage unavailable"))
	}
	// The discovery worker prohibits duplicate market identities. Check again at
	// this consumer boundary rather than letting QueryRow choose one silently.
	var count int
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM tickergarden.canonical_discovered_markets WHERE chain_id=$1 AND market_id=$2`, chain, c.MarketID).Scan(&count); e != nil || count != 1 {
		return fail(errors.New("ambiguous Treasury market discovery"))
	}
	if source < creation || source-creation >= MaxHistoryBlocks {
		return fail(errors.New("Treasury history range exceeds budget or predates creation"))
	}
	var market deployment.MarketDiscovery
	if json.Unmarshal(payload, &market) != nil || market.MarketID != c.MarketID || market.State["memeToken"] != c.MemeToken || market.State["quoteAsset"] != c.QuoteToken {
		return fail(errors.New("Treasury discovery identity mismatch"))
	}
	curve, ok := market.State["curve"].(string)
	if !ok || !addressRE.MatchString(curve) || curve == zero {
		return fail(errors.New("Treasury creation Curve unavailable"))
	}
	var rawCreation []byte
	if e = tx.QueryRow(ctx, `SELECT payload FROM tickergarden.chain_logs WHERE chain_id=$1 AND block_hash=$2 AND log_index=$3`, chain, creationHash, creationIndex).Scan(&rawCreation); e != nil {
		return fail(errors.New("market creation source unavailable"))
	}
	var created chainrpc.Log
	if json.Unmarshal(rawCreation, &created) != nil || !reflect.DeepEqual(created, market.Source) || created.BlockHash != creationHash || created.BlockNumber != fmt.Sprintf("0x%x", creation) || created.LogIndex != fmt.Sprintf("0x%x", creationIndex) || created.Removed {
		return fail(errors.New("market discovery source differs from journal"))
	}
	decoded, e := events.Decode("TickerGardenFactoryV1", created)
	if e != nil || decoded.Args["marketId"] != c.MarketID || decoded.Args["memeToken"] != c.MemeToken || decoded.Args["curve"] != curve {
		return fail(errors.New("invalid market creation event"))
	}
	blocks := map[string]historyBlock{}
	rows, e := tx.Query(ctx, `SELECT number,hash,parent_hash,block_timestamp,receipts_verified,receipts_root,root_receipt_set_hash,receipt_count FROM tickergarden.chain_blocks WHERE chain_id=$1 AND canonical AND number BETWEEN $2 AND $3 ORDER BY number`, chain, creation, source)
	if e != nil {
		return fail(errors.New("cannot read Treasury block range"))
	}
	expected := creation
	var prior historyBlock
	for rows.Next() {
		var b historyBlock
		var timestamp *uint64
		var verified bool
		if e = rows.Scan(&b.number, &b.hash, &b.parent, &timestamp, &verified, &b.root, &b.rootCommitment, &b.receiptCount); e != nil {
			rows.Close()
			return fail(errors.New("invalid Treasury block row"))
		}
		if b.number != expected || timestamp == nil || !verified || !hashRE.MatchString(b.hash) || !hashRE.MatchString(b.parent) {
			rows.Close()
			return fail(errors.New("incomplete Treasury block coverage"))
		}
		b.time = *timestamp
		if expected > creation && (b.parent != prior.hash || b.time < prior.time) {
			rows.Close()
			return fail(errors.New("Treasury block range is not contiguous"))
		}
		blocks[b.hash] = b
		prior = b
		expected++
	}
	e = rows.Err()
	rows.Close()
	if e != nil || expected != source+1 || prior.hash != c.SourceBlockHash || strconv.FormatUint(prior.time, 10) != in.SourceBlockTimestamp {
		return fail(errors.New("Treasury source range or timestamp mismatch"))
	}
	if _, ok := blocks[creationHash]; !ok {
		return fail(errors.New("Treasury creation block not in range"))
	}
	// Reconstruct target-token logs from receipts, then compare both directions
	// with the journal filter rows. A deleted Transfer cannot become an empty set.
	topic := hash([]byte("Transfer(address,address,uint256)"))
	receiptLogs := map[string]chainrpc.Log{}
	creationInReceipt := false
	budget := historyBudget{}
	if e = budget.retain(len(payload) + len(rawCreation)); e != nil {
		return fail(e)
	}
	rows, e = tx.Query(ctx, `SELECT r.block_hash,r.transaction_hash,r.transaction_index,r.status,r.payload FROM tickergarden.chain_receipts r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE r.chain_id=$1 AND b.canonical AND b.number BETWEEN $2 AND $3 ORDER BY b.number,r.transaction_index`, chain, creation, source)
	if e != nil {
		return fail(errors.New("cannot read Treasury receipts"))
	}
	rootCovered := true
	for _, b := range blocks {
		if b.root == nil || b.rootCommitment == nil || b.receiptCount == nil {
			rootCovered = false
		}
	}
	accumulator := chainrpc.NewReceiptSetAccumulator()
	currentReceiptBlock := ""
	checkReceiptBlock := func(bh string, sum string, count uint64) error {
		b := blocks[bh]
		if b.root != nil && (b.rootCommitment == nil || b.receiptCount == nil || !hashRE.MatchString(*b.root) || *b.receiptCount != int(count) || *b.rootCommitment != sum) {
			return errors.New("Treasury receipt root evidence differs from stored receipts")
		}
		return nil
	}
	receiptIndexes := map[string]uint64{}
	for rows.Next() {
		var bh, th, status string
		var index uint64
		var data []byte
		if e = rows.Scan(&bh, &th, &index, &status, &data); e != nil {
			rows.Close()
			return fail(errors.New("invalid Treasury receipt row"))
		}
		if e = budget.receipt(len(data)); e != nil {
			rows.Close()
			return fail(e)
		}
		b, ok := blocks[bh]
		var receipt chainrpc.Receipt
		if !ok || json.Unmarshal(data, &receipt) != nil || receipt.TransactionHash != th || receipt.BlockHash != bh || receipt.BlockNumber != fmt.Sprintf("0x%x", b.number) || receipt.TransactionIndex != fmt.Sprintf("0x%x", index) || receipt.Status != status || (status != "0x0" && status != "0x1") || receipt.Logs == nil || index != receiptIndexes[bh] || (status == "0x0" && len(receipt.Logs) != 0) {
			rows.Close()
			return fail(errors.New("Treasury receipt provenance mismatch"))
		}
		if bh != currentReceiptBlock {
			if currentReceiptBlock != "" {
				if err := checkReceiptBlock(currentReceiptBlock, accumulator.Sum(), receiptIndexes[currentReceiptBlock]); err != nil {
					rows.Close()
					return fail(err)
				}
			}
			currentReceiptBlock = bh
			accumulator = chainrpc.NewReceiptSetAccumulator()
		}
		if err := accumulator.Add(receipt); err != nil {
			rows.Close()
			return fail(err)
		}
		receiptIndexes[bh]++
		for _, log := range receipt.Logs {
			if log.BlockHash != bh || log.BlockNumber != receipt.BlockNumber || log.TransactionHash != th || log.TransactionIndex != receipt.TransactionIndex || log.Removed {
				rows.Close()
				return fail(errors.New("Treasury receipt log provenance mismatch"))
			}
			if reflect.DeepEqual(log, created) {
				creationInReceipt = true
			}
			if strings.ToLower(log.Address) != c.MemeToken || len(log.Topics) == 0 || strings.ToLower(log.Topics[0]) != topic {
				continue
			}
			retained, err := json.Marshal(log)
			if err != nil {
				rows.Close()
				return fail(errors.New("cannot measure Treasury Transfer payload"))
			}
			if err = budget.retain(len(retained)); err != nil {
				rows.Close()
				return fail(err)
			}
			li, e := chainrpc.Quantity(log.LogIndex)
			if e != nil {
				rows.Close()
				return fail(e)
			}
			key := bh + ":" + strconv.FormatUint(li, 10)
			if _, ok := receiptLogs[key]; ok {
				rows.Close()
				return fail(errors.New("duplicate Treasury Transfer receipt"))
			}
			receiptLogs[key] = log
			if len(receiptLogs) > MaxHistoryTransfers {
				rows.Close()
				return fail(errors.New("Treasury Transfer budget exceeded"))
			}
		}
	}
	e = rows.Err()
	rows.Close()
	if currentReceiptBlock != "" {
		if err := checkReceiptBlock(currentReceiptBlock, accumulator.Sum(), receiptIndexes[currentReceiptBlock]); err != nil {
			return fail(err)
		}
	}
	emptyCommitment := chainrpc.NewReceiptSetAccumulator().Sum()
	for bh := range blocks {
		if receiptIndexes[bh] == 0 {
			if err := checkReceiptBlock(bh, emptyCommitment, 0); err != nil {
				return fail(err)
			}
		}
	}
	if e != nil || !creationInReceipt {
		return fail(errors.New("Treasury creation receipt missing"))
	}
	rows, e = tx.Query(ctx, `SELECT l.block_hash,l.log_index,l.payload FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash WHERE l.chain_id=$1 AND b.canonical AND b.number BETWEEN $2 AND $3 AND l.address=$4 ORDER BY b.number,l.log_index`, chain, creation, source, c.MemeToken)
	if e != nil {
		return fail(errors.New("cannot read Treasury Transfers"))
	}
	transfers := []Transfer{}
	mintCount := 0
	initialMint := ""
	for rows.Next() {
		var bh string
		var index uint64
		var data []byte
		if e = rows.Scan(&bh, &index, &data); e != nil {
			rows.Close()
			return fail(errors.New("invalid Treasury log row"))
		}
		if e = budget.retain(len(data)); e != nil {
			rows.Close()
			return fail(e)
		}
		var log chainrpc.Log
		if json.Unmarshal(data, &log) != nil || strings.ToLower(log.Address) != c.MemeToken {
			rows.Close()
			return fail(errors.New("Treasury token row mismatch"))
		}
		if len(log.Topics) == 0 || strings.ToLower(log.Topics[0]) != topic {
			continue
		}
		key := bh + ":" + strconv.FormatUint(index, 10)
		expected, ok := receiptLogs[key]
		if !ok || !reflect.DeepEqual(log, expected) {
			rows.Close()
			return fail(errors.New("Treasury Transfer differs from receipt"))
		}
		delete(receiptLogs, key)
		decoded, e := events.Decode("TickerMemeTokenV1", log)
		if e != nil {
			rows.Close()
			return fail(e)
		}
		from, to, value := decoded.Args["from"].(string), decoded.Args["to"].(string), decoded.Args["value"].(string)
		n, e := integer(value, 256)
		if e != nil {
			rows.Close()
			return fail(e)
		}
		if from == zero {
			mintCount++
			if mintCount != 1 || bh != creationHash || log.TransactionHash != created.TransactionHash || index >= creationIndex || to != curve || n.Sign() == 0 {
				rows.Close()
				return fail(errors.New("Treasury initial issuance mismatch"))
			}
			initialMint = value
		}
		b := blocks[bh]
		ti, _ := chainrpc.Quantity(log.TransactionIndex)
		transfers = append(transfers, Transfer{BlockNumber: strconv.FormatUint(b.number, 10), TransactionIndex: ti, LogIndex: index, Timestamp: strconv.FormatUint(b.time, 10), From: from, To: to, Value: value})
	}
	e = rows.Err()
	rows.Close()
	if e != nil || len(receiptLogs) != 0 || mintCount != 1 {
		return fail(errors.New("incomplete Treasury Transfer or initial issuance history"))
	}
	in.Context = c
	in.Transfers = transfers
	return in, JournalEvidence{ChainID: chain, ManifestHash: manifestHash, CreationBlock: creation, SourceBlock: source, SourceHash: c.SourceBlockHash, BlockCount: source - creation + 1, TransferCount: len(transfers), InitialMint: initialMint, JournalRangeChecked: true, ReceiptRootVerified: rootCovered}, nil
}
