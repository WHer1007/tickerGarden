package treasury

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

// PendingRoot is an observation, not authorization to finalize or cancel.
type PendingRoot struct {
	Snapshot              deployment.TreasuryRequestSnapshot `json:"snapshot"`
	ObservedTimestamp     string                             `json:"observedTimestamp"`
	FinalizeReady         bool                               `json:"finalizeReady"`
	FinalizeEffect        string                             `json:"finalizeEffect"`
	TransactionSubmission bool                               `json:"transactionSubmission"`
}

func ObservePendingRoot(ctx context.Context, rpc PublicationRPC, manifest deployment.Manifest, market string, epoch uint32) (PendingRoot, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	manifest, _, err := jobManifest(manifest)
	if err != nil {
		return PendingRoot{}, err
	}
	block, err := rpc.Header(ctx, "latest")
	if err != nil {
		return PendingRoot{}, errors.New("lifecycle RPC unavailable")
	}
	at, err := block.Time()
	now := time.Now().Unix()
	if err != nil || now < 0 || at > uint64(now)+15 || (at < uint64(now) && uint64(now)-at > 120) {
		return PendingRoot{}, errors.New("lifecycle observation stale")
	}
	snap, err := deployment.ObserveTreasuryPendingEpoch(ctx, rpc, manifest, block, market, epoch)
	if err != nil {
		return PendingRoot{}, err
	}
	after, _ := strconv.ParseUint(snap.Epoch["finalizeAfter"].(string), 10, 64)
	effect := "claiming"
	if snap.Epoch["leafCount"] == "0" {
		effect = "rolled_over"
	}
	return PendingRoot{Snapshot: snap, ObservedTimestamp: strconv.FormatUint(at, 10), FinalizeReady: at >= after, FinalizeEffect: effect}, nil
}

func lifecycleData(action, market string, epoch uint32, reason string) string {
	signature := "finalizeRoot(bytes32,uint32)"
	if action == "cancel" {
		signature = "cancelPendingRoot(bytes32,uint32,bytes32)"
	}
	data := decode(hash([]byte(signature)))[:4]
	data = append(data, hexWord(market)...)
	data = append(data, uintWord(uint64(epoch))...)
	if action == "cancel" {
		data = append(data, hexWord(reason)...)
	}
	return "0x" + hex.EncodeToString(data)
}

func simulateLifecycle(ctx context.Context, rpc PublicationRPC, pending PendingRoot, sender, action, reason string) (PublicationPlan, error) {
	sender = strings.ToLower(sender)
	if !addressRE.MatchString(sender) || sender == zero {
		return PublicationPlan{}, errors.New("invalid lifecycle sender")
	}
	s := pending.Snapshot
	data := lifecycleData(action, s.MarketID, s.EpochID, reason)
	result, err := rpc.SimulateAt(ctx, sender, s.Distributor, data, s.BlockHash)
	if err != nil || len(result) != 0 {
		return PublicationPlan{}, errors.New("lifecycle transaction simulation failed")
	}
	last, err := rpc.Header(ctx, s.BlockNumber)
	at, timeErr := last.Time()
	if err != nil || timeErr != nil || last.Hash != s.BlockHash || strconv.FormatUint(at, 10) != pending.ObservedTimestamp {
		return PublicationPlan{}, errors.New("lifecycle observation changed")
	}
	return PublicationPlan{Status: "simulated_unsigned", ChainID: s.ChainID, From: sender, To: s.Distributor, Data: data, Value: "0x0", ObservedBlockHash: s.BlockHash}, nil
}

// PrepareCancellation binds operator intent to both on-chain commitments. It
// deliberately does not require a local candidate: an unknown root may need
// cancellation. AccessManager authority is checked by the sender-specific call.
func PrepareCancellation(ctx context.Context, rpc PublicationRPC, manifest deployment.Manifest, market string, epoch uint32, sender, expectedRoot, expectedDataset, reason string) (PublicationPlan, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	for _, value := range []string{expectedRoot, expectedDataset, reason} {
		if !hashRE.MatchString(value) || value == "0x"+strings.Repeat("0", 64) {
			return PublicationPlan{}, errors.New("cancellation requires nonzero expected root, dataset and reason hash")
		}
	}
	pending, err := ObservePendingRoot(ctx, rpc, manifest, market, epoch)
	if err != nil {
		return PublicationPlan{}, err
	}
	if pending.Snapshot.Epoch["merkleRoot"] != strings.ToLower(expectedRoot) || pending.Snapshot.Epoch["datasetHash"] != strings.ToLower(expectedDataset) {
		return PublicationPlan{}, errors.New("pending commitment differs from cancellation target")
	}
	return simulateLifecycle(ctx, rpc, pending, sender, "cancel", reason)
}

// PrepareFinalization requires the current independent approval and exact
// candidate commitment, even though the contract finalizer is permissionless.
func PrepareFinalization(ctx context.Context, pool *pgxpool.Pool, rpc PublicationRPC, manifest deployment.Manifest, id, sender string) (PublicationPlan, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	c, err := ReadCandidate(ctx, pool, id)
	if err != nil {
		return PublicationPlan{}, err
	}
	review, err := LatestReview(ctx, pool, id)
	if err != nil {
		return PublicationPlan{}, err
	}
	manifest, mh, err := jobManifest(manifest)
	if err != nil {
		return PublicationPlan{}, err
	}
	if review.Decision != "approved" || !review.ReferenceMatched || !review.JournalReplayed || !review.ReceiptRootVerified || !c.Journal.ReceiptRootVerified || review.ManifestHash != mh || review.MerkleRoot != c.Dataset.MerkleRoot || review.DatasetHash != c.Dataset.DatasetHash {
		return PublicationPlan{}, errors.New("current review does not authorize finalization")
	}
	if err = compareReview(c, id, c.Dataset, review.Report, "approved", review.Reason); err != nil {
		return PublicationPlan{}, err
	}
	pending, err := ObservePendingRoot(ctx, rpc, manifest, c.Input.MarketID, c.Input.EpochID)
	if err != nil {
		return PublicationPlan{}, err
	}
	if !pending.FinalizeReady {
		return PublicationPlan{}, errors.New("Treasury root review delay has not elapsed")
	}
	if err = MatchRequest(c.Input, pending.Snapshot); err != nil {
		return PublicationPlan{}, err
	}
	e := pending.Snapshot.Epoch
	if e["merkleRoot"] != c.Dataset.MerkleRoot || e["datasetHash"] != c.Dataset.DatasetHash || e["totalTwab"] != c.Dataset.TotalTwab || e["leafCount"] != strconv.FormatUint(uint64(c.Dataset.LeafCount), 10) {
		return PublicationPlan{}, errors.New("pending commitment differs from approved candidate")
	}
	plan, err := simulateLifecycle(ctx, rpc, pending, sender, "finalize", "")
	if err != nil {
		return PublicationPlan{}, err
	}
	before, _ := json.Marshal(review)
	latest, err := LatestReview(ctx, pool, id)
	after, _ := json.Marshal(latest)
	if err != nil || string(before) != string(after) {
		return PublicationPlan{}, errors.New("review changed during finalization preparation")
	}
	plan.CandidateID = id
	plan.ReviewID = hash(before)
	plan.HistoryTrust = "independent_reviewer_attestation"
	return plan, nil
}
