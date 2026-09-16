package treasury

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

type PublicationRPC interface {
	deployment.BindingObserver
	SimulateAt(context.Context, string, string, string, string) ([]byte, error)
}
type PublicationPlan struct {
	Status                string `json:"status"`
	ChainID               uint64 `json:"chainId"`
	From                  string `json:"from"`
	To                    string `json:"to"`
	Data                  string `json:"data"`
	Value                 string `json:"value"`
	CandidateID           string `json:"candidateId"`
	ReviewID              string `json:"reviewId"`
	ObservedBlockHash     string `json:"observedBlockHash"`
	TransactionSubmission bool   `json:"transactionSubmission"`
	HistoryTrust          string `json:"historyTrust"`
}

func publishData(c Candidate) string {
	d := c.Dataset
	data := decode(hash([]byte("publishRoot(bytes32,uint32,bytes32,bytes32,uint256,uint32,uint256)")))[:4]
	data = append(data, hexWord(c.Input.MarketID)...)
	data = append(data, uintWord(uint64(c.Input.EpochID))...)
	data = append(data, hexWord(d.MerkleRoot)...)
	data = append(data, hexWord(d.DatasetHash)...)
	n, _ := integer(d.TotalTwab, 256)
	data = append(data, word(n)...)
	data = append(data, uintWord(uint64(d.LeafCount))...)
	n, _ = integer(d.TotalAllocated, 256)
	data = append(data, word(n)...)
	return "0x" + hex.EncodeToString(data)
}

// PreparePublication produces a simulated unsigned request. A broadcaster must
// freshly revalidate the review, request and simulation before using it.
func PreparePublication(ctx context.Context, pool *pgxpool.Pool, rpc PublicationRPC, manifest deployment.Manifest, id, publisher string) (PublicationPlan, error) {
	fail := func(err error) (PublicationPlan, error) { return PublicationPlan{}, err }
	publisher = strings.ToLower(publisher)
	if !addressRE.MatchString(publisher) || publisher == zero {
		return fail(errors.New("invalid publisher"))
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	c, err := ReadCandidate(ctx, pool, id)
	if err != nil {
		return fail(err)
	}
	review, err := LatestReview(ctx, pool, id)
	if err != nil {
		return fail(err)
	}
	var actor string
	if err = pool.QueryRow(ctx, `SELECT session_user`).Scan(&actor); err != nil || actor == review.Reviewer {
		return fail(errors.New("publisher and reviewer database identities must be separate"))
	}
	manifest, mh, err := jobManifest(manifest)
	if err != nil {
		return fail(err)
	}
	if review.Decision != "approved" || !review.ReferenceMatched || !review.JournalReplayed || !review.ReceiptRootVerified || !c.Journal.ReceiptRootVerified || review.ManifestHash != mh || review.MerkleRoot != c.Dataset.MerkleRoot || review.DatasetHash != c.Dataset.DatasetHash {
		return fail(errors.New("current review does not authorize this candidate and manifest"))
	}
	if err = compareReview(c, id, c.Dataset, review.Report, "approved", review.Reason); err != nil {
		return fail(err)
	}
	block, err := rpc.Header(ctx, "latest")
	if err != nil {
		return fail(errors.New("publication RPC unavailable"))
	}
	at, err := block.Time()
	now := time.Now().Unix()
	if err != nil || now < 0 || at > uint64(now)+15 || (at < uint64(now) && uint64(now)-at > 120) {
		return fail(errors.New("publication observation stale"))
	}
	observed, err := deployment.ObserveTreasuryRequest(ctx, rpc, manifest, block, c.Input.MarketID, c.Input.EpochID)
	if err != nil {
		return fail(err)
	}
	if err = MatchRequest(c.Input, observed); err != nil {
		return fail(err)
	}
	data := publishData(c)
	result, err := rpc.SimulateAt(ctx, publisher, c.Input.Distributor, data, block.Hash)
	if err != nil || len(result) != 0 {
		return fail(errors.New("publisher transaction simulation failed"))
	}
	last, err := rpc.Header(ctx, block.Number)
	if err != nil || last.Hash != block.Hash || last.Timestamp != block.Timestamp {
		return fail(errors.New("publication observation changed"))
	}
	reviewBytes, _ := json.Marshal(review)
	latest, err := LatestReview(ctx, pool, id)
	latestBytes, _ := json.Marshal(latest)
	if err != nil || string(latestBytes) != string(reviewBytes) {
		return fail(errors.New("review changed during publication preparation"))
	}
	return PublicationPlan{Status: "simulated_unsigned", ChainID: manifest.ChainID, From: publisher, To: c.Input.Distributor, Data: data, Value: "0x0", CandidateID: id, ReviewID: hash(reviewBytes), ObservedBlockHash: block.Hash, HistoryTrust: "independent_reviewer_attestation"}, nil
}
