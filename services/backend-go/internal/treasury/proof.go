package treasury

import (
	"context"
	"errors"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

var ErrProofNotFound = errors.New("Treasury proof not found")
var ErrProofClaimed = errors.New("Treasury claim already consumed")
var ErrProofUnavailable = errors.New("Treasury proof service unavailable")
var ErrProofInput = errors.New("invalid Treasury proof identity")

// ClaimProof follows the frontend wire contract; uint256 values are decimal strings.
// ObservedBlockHash identifies a snapshot, not a promise that a transaction will succeed.
type ClaimProof struct {
	Schema              string   `json:"schema"`
	ExecutionSpecID     string   `json:"executionSpecId"`
	ChainID             uint64   `json:"chainId"`
	Distributor         string   `json:"distributor"`
	MarketID            string   `json:"marketId"`
	EpochID             uint32   `json:"epochId"`
	LeafIndex           string   `json:"leafIndex"`
	Account             string   `json:"account"`
	Twab                string   `json:"twab"`
	Amount              string   `json:"amount"`
	MerkleRoot          string   `json:"merkleRoot"`
	DatasetHash         string   `json:"datasetHash"`
	Proof               []string `json:"proof"`
	ObservedBlockHash   string   `json:"observedBlockHash"`
	ObservedBlockNumber string   `json:"observedBlockNumber"`
}

type CandidateLookup interface {
	Find(context.Context, uint64, string, uint32, string) (Candidate, error)
}
type CandidateStore struct{ Pool *pgxpool.Pool }

func (s CandidateStore) Find(ctx context.Context, chain uint64, market string, epoch uint32, dataset string) (Candidate, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `SELECT id FROM tickergarden.treasury_candidates WHERE chain_id=$1 AND market_id=$2 AND epoch_id=$3 AND dataset_hash=$4 ORDER BY id LIMIT 1`, chain, market, epoch, dataset).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Candidate{}, ErrProofNotFound
	}
	if err != nil {
		return Candidate{}, ErrProofUnavailable
	}
	return ReadCandidate(ctx, s.Pool, id)
}

// ProofService performs fresh hash-pinned RPC reads per query. Its bounded slots
// cap concurrent artifact recomputation. Construct with NewProofService.
type ProofService struct {
	rpc        deployment.BindingObserver
	manifest   deployment.Manifest
	candidates CandidateLookup
	slots      chan struct{}
	now        func() time.Time
}

func NewProofService(rpc deployment.BindingObserver, manifest deployment.Manifest, candidates CandidateLookup) *ProofService {
	return &ProofService{rpc: rpc, manifest: manifest, candidates: candidates, slots: make(chan struct{}, 2), now: time.Now}
}
func (s *ProofService) ClaimProof(ctx context.Context, market string, epoch uint32, account string) (ClaimProof, error) {
	fail := func(err error) (ClaimProof, error) { return ClaimProof{}, err }
	if !hashRE.MatchString(market) || strings.EqualFold(market, "0x"+strings.Repeat("0", 64)) || !addressRE.MatchString(account) || strings.EqualFold(account, zero) || epoch == 0 {
		return fail(ErrProofInput)
	}
	market, account = strings.ToLower(market), strings.ToLower(account)
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		return fail(ErrProofUnavailable)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	block, err := s.rpc.Header(ctx, "latest")
	if err != nil || !s.fresh(block) {
		return fail(ErrProofUnavailable)
	}
	observed, err := deployment.ObserveTreasuryClaimEpoch(ctx, s.rpc, s.manifest, block, market, epoch)
	if err != nil {
		return fail(err)
	}
	candidate, err := s.candidates.Find(ctx, s.manifest.ChainID, market, epoch, observed.Epoch["datasetHash"].(string))
	if err != nil {
		return fail(err)
	}
	proof, err := proofForCandidate(candidate, observed, account)
	if err != nil {
		return fail(err)
	}
	consumed, err := deployment.TreasuryClaimConsumed(ctx, s.rpc, block, observed.Distributor, market, epoch, uint32Must(proof.LeafIndex), account)
	if err != nil || ctx.Err() != nil || !s.fresh(block) {
		return fail(ErrProofUnavailable)
	}
	if consumed {
		return fail(ErrProofClaimed)
	}
	if !claimFits(proof.Amount, observed.Epoch) {
		return fail(ErrProofUnavailable)
	}
	return proof, nil
}
func uint32Must(s string) uint32 { n, _ := strconv.ParseUint(s, 10, 32); return uint32(n) }
func (s *ProofService) fresh(block chainrpc.Header) bool {
	timestamp, err := block.Time()
	if err != nil {
		return false
	}
	now := s.now().Unix()
	return now >= 0 && timestamp <= uint64(now)+15 && (timestamp >= uint64(now) || uint64(now)-timestamp <= 120)
}
func proofForCandidate(c Candidate, observed deployment.TreasuryRequestSnapshot, account string) (ClaimProof, error) {
	fail := func(err error) (ClaimProof, error) { return ClaimProof{}, err }
	if err := MatchRequest(c.Input, observed); err != nil {
		return fail(err)
	}
	d := c.Dataset
	if observed.Epoch["status"] != "3" || observed.Epoch["merkleRoot"] != d.MerkleRoot || observed.Epoch["datasetHash"] != d.DatasetHash || observed.Epoch["leafCount"] != strconv.FormatUint(uint64(d.LeafCount), 10) || observed.Epoch["totalTwab"] != d.TotalTwab || d.TotalAllocated != c.Input.QuoteAmount {
		return fail(ErrProofUnavailable)
	}
	for _, leaf := range d.Leaves {
		if leaf.Account != account {
			continue
		}
		if account == observed.Distributor || leaf.Index >= d.LeafCount {
			return fail(ErrProofUnavailable)
		}
		digest, err := HashLeaf(c.Input.Context, leaf.Index, account, leaf.Twab, leaf.Amount)
		if err != nil || digest != leaf.Leaf || !VerifyProof(digest, leaf.Proof, d.MerkleRoot) {
			return fail(ErrProofUnavailable)
		}
		amount, err := integer(leaf.Amount, 256)
		if err != nil || amount.Sign() == 0 {
			return fail(ErrProofUnavailable)
		}
		path := append([]string{}, leaf.Proof...)
		return ClaimProof{Schema: "TICKERGARDEN_V1_TREASURY_CLAIM_PROOF_V1", ExecutionSpecID: "V1-TREASURY-EXEC-1", ChainID: observed.ChainID, Distributor: observed.Distributor, MarketID: observed.MarketID, EpochID: observed.EpochID, LeafIndex: strconv.FormatUint(uint64(leaf.Index), 10), Account: account, Twab: leaf.Twab, Amount: leaf.Amount, MerkleRoot: d.MerkleRoot, DatasetHash: d.DatasetHash, Proof: path, ObservedBlockHash: observed.BlockHash, ObservedBlockNumber: observed.BlockNumber}, nil
	}
	return fail(ErrProofNotFound)
}
func stringValue(value any) string { s, _ := value.(string); return s }

func claimFits(amount string, epoch map[string]any) bool {
	a, err := integer(amount, 256)
	if err != nil || a.Sign() == 0 {
		return false
	}
	claimed, err := integer(stringValue(epoch["claimedAmount"]), 256)
	if err != nil {
		return false
	}
	total, err := integer(stringValue(epoch["quoteAmount"]), 256)
	if err != nil {
		return false
	}
	return new(big.Int).Add(claimed, a).Cmp(total) <= 0
}
