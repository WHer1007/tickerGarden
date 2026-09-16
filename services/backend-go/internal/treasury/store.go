package treasury

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/journal"
)

// Candidate is an immutable computation artifact, never a published-root record.
type Candidate struct {
	Input   Input                              `json:"input"`
	Dataset Output                             `json:"dataset"`
	Journal JournalEvidence                    `json:"journalEvidence"`
	Request deployment.TreasuryRequestSnapshot `json:"requestEvidence"`
}

func validateCandidate(c Candidate) error {
	if (c.Journal.ChainID != 4663 && c.Journal.ChainID != 46630 && c.Journal.ChainID != 421614) || !c.Journal.JournalRangeChecked || !c.Journal.RootRequestVerified || c.Journal.ChainID != c.Request.ChainID || c.Journal.SourceHash != c.Input.SourceBlockHash || strconv.FormatUint(c.Journal.SourceBlock, 10) != c.Input.SourceBlockNumber || c.Journal.TransferCount != len(c.Input.Transfers) {
		return errors.New("candidate journal evidence mismatch")
	}
	if c.Request.Epoch["status"] != "1" || !hashRE.MatchString(c.Request.BlockHash) || len(c.Request.BlockNumber) < 3 || c.Request.BlockNumber[:2] != "0x" {
		return errors.New("candidate request evidence unavailable")
	}
	if e := MatchRequest(c.Input, c.Request); e != nil {
		return e
	}
	output, e := Generate(c.Input)
	if e != nil {
		return e
	}
	if !reflect.DeepEqual(output, c.Dataset) {
		return errors.New("candidate computation differs from artifact")
	}
	return nil
}
func checkCandidateSource(ctx context.Context, tx pgx.Tx, c Candidate) error {
	var ok bool
	requestNumber, e := strconv.ParseUint(c.Request.BlockNumber[2:], 16, 63)
	if e != nil {
		return errors.New("invalid request block number")
	}
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickergarden.chain_journal j JOIN tickergarden.chain_blocks f ON f.chain_id=j.chain_id AND f.hash=j.finalized_hash AND f.number=j.finalized_number AND f.canonical AND f.receipts_verified JOIN tickergarden.chain_blocks s ON s.chain_id=j.chain_id AND s.hash=$2 AND s.canonical AND s.receipts_verified AND s.block_timestamp IS NOT NULL JOIN tickergarden.chain_blocks r ON r.chain_id=j.chain_id AND r.hash=$3 AND r.canonical AND r.receipts_verified AND r.block_timestamp IS NOT NULL WHERE j.chain_id=$1 AND s.number<r.number AND r.number<=j.finalized_number AND s.number=$4 AND r.number=$5 AND s.block_timestamp::text=$6)`, c.Journal.ChainID, c.Journal.SourceHash, c.Request.BlockHash, c.Journal.SourceBlock, requestNumber, c.Input.SourceBlockTimestamp).Scan(&ok)
	if e != nil || !ok {
		return errors.New("candidate source or request is no longer canonical finalized journal data")
	}
	if c.Journal.ReceiptRootVerified {
		if err := journal.VerifyStoredReceiptRoot(ctx, tx, c.Journal.ChainID, requestNumber, c.Request.BlockHash); err != nil {
			return err
		}
	}
	return nil
}
func SaveCandidate(ctx context.Context, pool *pgxpool.Pool, c Candidate) (string, error) {
	if e := validateCandidate(c); e != nil {
		return "", e
	}
	payload, e := json.Marshal(c)
	if e != nil || len(payload) > 128<<20 {
		return "", errors.New("candidate artifact exceeds size budget")
	}
	id := hash(payload)
	tx, e := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if e != nil {
		return "", errors.New("cannot open candidate store")
	}
	defer tx.Rollback(ctx)
	var locked bool
	if e = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, int64(730000000+c.Journal.ChainID)).Scan(&locked); e != nil || !locked {
		return "", errors.New("candidate store busy")
	}
	if e = checkCandidateSource(ctx, tx, c); e != nil {
		return "", e
	}
	if e = checkCandidateJournal(ctx, tx, c); e != nil {
		return "", e
	}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.treasury_candidates(id,chain_id,market_id,epoch_id,source_hash,request_hash,dataset_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`, id, c.Journal.ChainID, c.Input.MarketID, c.Input.EpochID, c.Journal.SourceHash, c.Request.BlockHash, c.Dataset.DatasetHash, payload)
	if e != nil {
		return "", errors.New("cannot persist Treasury candidate")
	}
	var stored []byte
	var storedChain uint64
	var storedMarket, storedSource, storedRequest, storedDataset string
	var storedEpoch uint32
	if e = tx.QueryRow(ctx, `SELECT payload,chain_id,market_id,epoch_id,source_hash,request_hash,dataset_hash FROM tickergarden.treasury_candidates WHERE id=$1`, id).Scan(&stored, &storedChain, &storedMarket, &storedEpoch, &storedSource, &storedRequest, &storedDataset); e != nil || string(stored) != string(payload) || storedChain != c.Journal.ChainID || storedMarket != c.Input.MarketID || storedEpoch != c.Input.EpochID || storedSource != c.Journal.SourceHash || storedRequest != c.Request.BlockHash || storedDataset != c.Dataset.DatasetHash {
		return "", errors.New("candidate content-address collision or corruption")
	}
	if e = tx.Commit(ctx); e != nil {
		return "", errors.New("cannot commit Treasury candidate")
	}
	return id, nil
}
func ReadCandidate(ctx context.Context, pool *pgxpool.Pool, id string) (Candidate, error) {
	if !hashRE.MatchString(id) {
		return Candidate{}, errors.New("invalid candidate id")
	}
	tx, e := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return Candidate{}, errors.New("cannot read candidate store")
	}
	defer tx.Rollback(ctx)
	var payload []byte
	var chain uint64
	var market, source, request, dataset string
	var epoch uint32
	e = tx.QueryRow(ctx, `SELECT payload,chain_id,market_id,epoch_id,source_hash,request_hash,dataset_hash FROM tickergarden.treasury_candidates WHERE id=$1`, id).Scan(&payload, &chain, &market, &epoch, &source, &request, &dataset)
	if e != nil || hash(payload) != id {
		return Candidate{}, errors.New("candidate missing or content digest mismatch")
	}
	var c Candidate
	if json.Unmarshal(payload, &c) != nil {
		return Candidate{}, errors.New("invalid candidate payload")
	}
	if c.Journal.ChainID != chain || c.Input.MarketID != market || c.Input.EpochID != epoch || c.Journal.SourceHash != source || c.Request.BlockHash != request || c.Dataset.DatasetHash != dataset {
		return Candidate{}, errors.New("candidate index mismatch")
	}
	if e = validateCandidate(c); e != nil {
		return Candidate{}, e
	}
	if e = checkCandidateSource(ctx, tx, c); e != nil {
		return Candidate{}, e
	}
	if e = checkCandidateJournal(ctx, tx, c); e != nil {
		return Candidate{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Candidate{}, errors.New("cannot close candidate read")
	}
	return c, nil
}

// A matching artifact digest/root does not establish that its Transfer input
// still matches the indexed receipt history. Compare within the same snapshot.
func checkCandidateJournal(ctx context.Context, tx pgx.Tx, c Candidate) error {
	seed := c.Input
	seed.Transfers = nil
	loaded, evidence, err := loadJournalInputTx(ctx, tx, seed)
	if err != nil {
		return err
	}
	expected := c.Journal
	// Request validation is a separate gate, not a claim made by the history loader.
	expected.RootRequestVerified = false
	if !reflect.DeepEqual(loaded, c.Input) || evidence != expected {
		return errors.New("Treasury artifact differs from current journal history")
	}
	return nil
}
