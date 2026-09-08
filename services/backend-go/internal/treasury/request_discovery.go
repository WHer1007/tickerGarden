package treasury

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
)

const rootRequestedSignature = "RootRequested(bytes32,uint32,address,uint64,uint64,uint64,bytes32,uint256,address,uint128,uint64)"

type EligibilityPolicy struct {
	ChainID          uint64   `json:"chainId"`
	MarketID         string   `json:"marketId"`
	PolicyHash       string   `json:"policyHash"`
	ExcludedAccounts []string `json:"excludedAccounts"`
}

func DecodePolicies(data []byte) ([]EligibilityPolicy, error) {
	if len(data) > 1<<20 {
		return nil, errors.New("policy file exceeds budget")
	}
	if err := rejectAmbiguousJSON(data); err != nil {
		return nil, err
	}
	var policies []EligibilityPolicy
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&policies); err != nil {
		return nil, errors.New("invalid eligibility policies")
	}
	policies, _, err := canonicalPolicies(policies)
	return policies, err
}
func canonicalPolicies(policies []EligibilityPolicy) ([]EligibilityPolicy, string, error) {
	if policies == nil || len(policies) > 1000 {
		return nil, "", errors.New("explicit policy array required, maximum 1000")
	}
	out := append([]EligibilityPolicy{}, policies...)
	seen := map[string]bool{}
	for i, p := range out {
		p.MarketID = strings.ToLower(p.MarketID)
		p.PolicyHash = strings.ToLower(p.PolicyHash)
		if !hashRE.MatchString(p.MarketID) || p.MarketID == "0x"+strings.Repeat("0", 64) {
			return nil, "", errors.New("invalid policy market")
		}
		if (p.ChainID != 4663 && p.ChainID != 46630 && p.ChainID != 421614) || p.ExcludedAccounts == nil {
			return nil, "", errors.New("invalid policy scope or missing exclusion list")
		}
		h, err := PolicyHash(strconv.FormatUint(p.ChainID, 10), p.MarketID, p.ExcludedAccounts)
		if err != nil || h != p.PolicyHash {
			return nil, "", errors.New("eligibility policy commitment mismatch")
		}
		p.ExcludedAccounts, _ = normalizeAddresses(p.ExcludedAccounts)
		key := fmt.Sprintf("%d:%s:%s", p.ChainID, p.MarketID, p.PolicyHash)
		if seen[key] {
			return nil, "", errors.New("duplicate eligibility policy")
		}
		seen[key] = true
		out[i] = p
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.ChainID != b.ChainID {
			return a.ChainID < b.ChainID
		}
		if a.MarketID != b.MarketID {
			return a.MarketID < b.MarketID
		}
		return a.PolicyHash < b.PolicyHash
	})
	payload, _ := json.Marshal(out)
	if len(payload) > 1<<20 {
		return nil, "", errors.New("policy set exceeds budget")
	}
	return out, hash(payload), nil
}

type DiscoveryResult struct {
	Queued            int    `json:"queued"`
	Inactive          int    `json:"inactive"`
	AwaitingPolicy    int    `json:"awaitingPolicy"`
	ObservedBlockHash string `json:"observedBlockHash"`
}
type requestLog struct {
	log       chainrpc.Log
	timestamp uint64
}

// DiscoverRequests processes at most ten finalized journal events atomically.
// The shared chain lock protects journal provenance during bounded RPC reads.
// Missing policy is durable/retryable and never implies empty eligibility.
func DiscoverRequests(ctx context.Context, pool *pgxpool.Pool, rpc deployment.BindingObserver, manifest deployment.Manifest, policies []EligibilityPolicy) (DiscoveryResult, error) {
	fail := func(err error) (DiscoveryResult, error) { return DiscoveryResult{}, err }
	manifest, mh, err := jobManifest(manifest)
	if err != nil {
		return fail(err)
	}
	policies, ph, err := canonicalPolicies(policies)
	if err != nil {
		return fail(err)
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return fail(errors.New("cannot open request discovery"))
	}
	defer tx.Rollback(ctx)
	var locked bool
	if err = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock_shared($1)`, int64(730000000+manifest.ChainID)).Scan(&locked); err != nil || !locked {
		return fail(errors.New("request discovery journal busy"))
	}
	// One discovery transaction per manifest avoids conflicting mapping updates.
	if err = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 819))`, mh).Scan(&locked); err != nil || !locked {
		return fail(errors.New("request discovery already running"))
	}
	var height, timestamp uint64
	var blockHash string
	err = tx.QueryRow(ctx, `SELECT b.number,b.hash,b.block_timestamp FROM tickergarden.chain_journal j JOIN tickergarden.chain_blocks b ON b.chain_id=j.chain_id AND b.number=j.finalized_number AND b.hash=j.finalized_hash AND b.canonical AND b.receipts_verified AND b.block_timestamp IS NOT NULL WHERE j.chain_id=$1 AND j.genesis_hash=$2`, manifest.ChainID, manifest.GenesisHash).Scan(&height, &blockHash, &timestamp)
	if err != nil {
		return fail(errors.New("finalized journal anchor unavailable"))
	}
	block := chainrpc.Header{Number: fmt.Sprintf("0x%x", height), Hash: blockHash, Timestamp: fmt.Sprintf("0x%x", timestamp)}
	distributor := ""
	for _, c := range manifest.Contracts {
		if c.Module == "TreasuryDistributorV1" {
			distributor = c.Address
		}
	}
	rows, err := tx.Query(ctx, `SELECT l.payload,b.block_timestamp,b.number,b.hash,l.log_index FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash LEFT JOIN tickergarden.treasury_request_discovery d ON d.chain_id=l.chain_id AND d.manifest_hash=$3 AND d.block_hash=l.block_hash AND d.log_index=l.log_index WHERE l.chain_id=$1 AND l.address=$2 AND b.canonical AND b.receipts_verified AND b.block_timestamp IS NOT NULL AND b.number<=$4 AND l.payload->'topics'->>0=$5 AND (d.state IS NULL OR (d.state='awaiting_policy' AND d.policy_set_hash<>$6)) ORDER BY b.number,l.log_index LIMIT 10`, manifest.ChainID, distributor, mh, height, hash([]byte(rootRequestedSignature)), ph)
	if err != nil {
		return fail(errors.New("cannot scan request events"))
	}
	var logs []requestLog
	for rows.Next() {
		var raw []byte
		var at, number, index uint64
		var bh string
		if err = rows.Scan(&raw, &at, &number, &bh, &index); err != nil {
			rows.Close()
			return fail(err)
		}
		var log chainrpc.Log
		if len(raw) > 16<<10 || json.Unmarshal(raw, &log) != nil || log.Removed || log.Address != distributor || log.BlockHash != bh || log.BlockNumber != fmt.Sprintf("0x%x", number) || log.LogIndex != fmt.Sprintf("0x%x", index) {
			rows.Close()
			return fail(errors.New("request log provenance mismatch"))
		}
		logs = append(logs, requestLog{log, at})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return fail(err)
	}
	result := DiscoveryResult{ObservedBlockHash: block.Hash}
	for _, entry := range logs {
		if err = verifyRequestReceipt(ctx, tx, manifest.ChainID, entry.log); err != nil {
			return fail(err)
		}
		decoded, err := events.Decode("TreasuryDistributorV1", entry.log)
		if err != nil || decoded.Signature != rootRequestedSignature {
			return fail(errors.New("invalid RootRequested event"))
		}
		epoch, err := strconv.ParseUint(stringValue(decoded.Args["epochId"]), 10, 32)
		if err != nil || epoch == 0 {
			return fail(errors.New("invalid requested epoch"))
		}
		market := stringValue(decoded.Args["marketId"])
		observed, err := deployment.ObserveTreasuryRequest(ctx, rpc, manifest, block, market, uint32(epoch))
		state := "inactive"
		var jobID *string
		if err != nil && !errors.Is(err, deployment.ErrTreasuryRequestInactive) && !errors.Is(err, deployment.ErrTreasuryRequestExpired) {
			return fail(err)
		}
		if err == nil && observed.Epoch["requestedAt"] == strconv.FormatUint(entry.timestamp, 10) && !requestEventMatches(entry, decoded.Args, observed) {
			return fail(errors.New("request event differs from committed epoch"))
		}
		if err == nil && requestEventMatches(entry, decoded.Args, observed) {
			var exclusions []string
			for _, p := range policies {
				if p.ChainID == manifest.ChainID && p.MarketID == market && p.PolicyHash == observed.Market["eligibilityPolicyHash"] {
					exclusions = p.ExcludedAccounts
					break
				}
			}
			if exclusions == nil {
				state = "awaiting_policy"
			} else {
				input := Input{Context: Context{ChainID: strconv.FormatUint(manifest.ChainID, 10), Distributor: distributor, MarketID: market, EpochID: uint32(epoch), MemeToken: stringValue(observed.Market["memeToken"]), QuoteToken: stringValue(observed.Market["quoteToken"]), EligibilityPolicyHash: stringValue(observed.Market["eligibilityPolicyHash"]), WindowStart: stringValue(observed.Window["start"]), WindowEnd: stringValue(observed.Window["end"]), SourceBlockNumber: stringValue(observed.Epoch["sourceBlockNumber"]), SourceBlockHash: stringValue(observed.Epoch["sourceBlockHash"])}, ExcludedAccounts: exclusions, SourceBlockTimestamp: observed.SourceTimestamp, QuoteAmount: stringValue(observed.Epoch["quoteAmount"]), Transfers: []Transfer{}}
				id, e := enqueueJob(ctx, tx, JobSpec{Input: input, Manifest: manifest})
				if e != nil {
					return fail(e)
				}
				jobID = &id
				state = "queued"
			}
		}
		index, _ := strconv.ParseUint(entry.log.LogIndex[2:], 16, 63)
		_, err = tx.Exec(ctx, `INSERT INTO tickergarden.treasury_request_discovery(chain_id,manifest_hash,block_hash,log_index,observed_hash,policy_set_hash,state,job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(chain_id,manifest_hash,block_hash,log_index) DO UPDATE SET observed_hash=EXCLUDED.observed_hash,policy_set_hash=EXCLUDED.policy_set_hash,state=EXCLUDED.state,job_id=EXCLUDED.job_id,updated_at=now()`, manifest.ChainID, mh, entry.log.BlockHash, index, block.Hash, ph, state, jobID)
		if err != nil {
			return fail(errors.New("cannot record request discovery"))
		}
		switch state {
		case "queued":
			result.Queued++
		case "inactive":
			result.Inactive++
		case "awaiting_policy":
			result.AwaitingPolicy++
		}
	}
	last, err := rpc.Header(ctx, block.Number)
	if err != nil || last.Hash != block.Hash || last.Timestamp != block.Timestamp {
		return fail(errors.New("request discovery finalized observation changed"))
	}
	if err = tx.Commit(ctx); err != nil {
		return fail(errors.New("cannot commit request discovery"))
	}
	return result, nil
}
func requestEventMatches(entry requestLog, args map[string]any, o deployment.TreasuryRequestSnapshot) bool {
	if o.Epoch["requestedAt"] != strconv.FormatUint(entry.timestamp, 10) {
		return false
	}
	for _, key := range []string{"requester", "sourceBlockNumber", "sourceBlockHash", "quoteAmount", "serviceFeeAsset", "serviceFeeAmount", "publishBy"} {
		if args[key] != o.Epoch[key] {
			return false
		}
	}
	return args["windowStart"] == o.Window["start"] && args["windowEnd"] == o.Window["end"]
}
func verifyRequestReceipt(ctx context.Context, tx pgx.Tx, chain uint64, log chainrpc.Log) error {
	var raw []byte
	var index uint64
	var status string
	err := tx.QueryRow(ctx, `SELECT payload,transaction_index,status FROM tickergarden.chain_receipts WHERE chain_id=$1 AND block_hash=$2 AND transaction_hash=$3`, chain, log.BlockHash, log.TransactionHash).Scan(&raw, &index, &status)
	if err != nil || len(raw) > 4<<20 {
		return errors.New("request receipt unavailable")
	}
	var receipt chainrpc.Receipt
	if json.Unmarshal(raw, &receipt) != nil || receipt.Status != "0x1" || status != "0x1" || receipt.BlockHash != log.BlockHash || receipt.BlockNumber != log.BlockNumber || receipt.TransactionHash != log.TransactionHash || receipt.TransactionIndex != log.TransactionIndex || receipt.TransactionIndex != fmt.Sprintf("0x%x", index) {
		return errors.New("request receipt provenance mismatch")
	}
	matches := 0
	for _, item := range receipt.Logs {
		if reflect.DeepEqual(item, log) {
			matches++
		}
	}
	if matches != 1 {
		return errors.New("request event not uniquely present in receipt")
	}
	return nil
}
