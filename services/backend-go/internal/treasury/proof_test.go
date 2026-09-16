package treasury

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"time"
)

func claimFixture(t *testing.T, fixture int) (Candidate, deployment.TreasuryRequestSnapshot) {
	t.Helper()
	in := goldens(t)[fixture].Input
	in.Context = normalizedContext(in.Context)
	out, err := Generate(in)
	if err != nil {
		t.Fatal(err)
	}
	chain, _ := strconv.ParseUint(in.ChainID, 10, 64)
	observed := deployment.TreasuryRequestSnapshot{ChainID: chain, Distributor: in.Distributor, MarketID: in.MarketID, EpochID: in.EpochID, EpochDuration: strconv.FormatUint(Duration, 10), TwabSchema: twabSchema, SourceTimestamp: in.SourceBlockTimestamp, BlockHash: in.SourceBlockHash, BlockNumber: "0x100", Market: map[string]any{"memeToken": in.MemeToken, "quoteToken": in.QuoteToken, "eligibilityPolicyHash": in.EligibilityPolicyHash}, Epoch: map[string]any{"status": "3", "sourceBlockNumber": in.SourceBlockNumber, "sourceBlockHash": in.SourceBlockHash, "quoteAmount": in.QuoteAmount, "merkleRoot": out.MerkleRoot, "datasetHash": out.DatasetHash, "leafCount": strconv.FormatUint(uint64(out.LeafCount), 10), "totalTwab": out.TotalTwab, "claimedAmount": "0"}, Window: map[string]any{"start": in.WindowStart, "end": in.WindowEnd}}
	return Candidate{Input: in, Dataset: out}, observed
}
func TestProofMatchesCommittedGoldenDatasets(t *testing.T) {
	for i := range goldens(t) {
		c, observed := claimFixture(t, i)
		for _, leaf := range c.Dataset.Leaves {
			got, err := proofForCandidate(c, observed, leaf.Account)
			if err != nil || got.Amount != leaf.Amount || got.LeafIndex != strconv.FormatUint(uint64(leaf.Index), 10) || got.DatasetHash != c.Dataset.DatasetHash || got.ObservedBlockHash != observed.BlockHash {
				t.Fatal(got, err)
			}
			if !VerifyProof(leaf.Leaf, got.Proof, got.MerkleRoot) {
				t.Fatal("bad served proof")
			}
			raw, _ := json.Marshal(got)
			var wire map[string]any
			json.Unmarshal(raw, &wire)
			if _, ok := wire["amount"].(string); !ok {
				t.Fatal("uint256 is not string")
			}
			if _, ok := wire["proof"].([]any); !ok {
				t.Fatal("proof must be an array even for singleton")
			}
		}
	}
}
func TestProofRejectsUnpublishedOrMismatchedArtifact(t *testing.T) {
	for _, name := range []string{"status", "root", "dataset", "count", "twab", "source", "funding", "allocation", "leaf", "path", "index", "missing account"} {
		t.Run(name, func(t *testing.T) {
			c, o := claimFixture(t, 1)
			account := c.Dataset.Leaves[0].Account
			switch name {
			case "status":
				o.Epoch["status"] = "2"
			case "root":
				o.Epoch["merkleRoot"] = emptyRoot
			case "dataset":
				o.Epoch["datasetHash"] = emptyRoot
			case "count":
				o.Epoch["leafCount"] = "0"
			case "twab":
				o.Epoch["totalTwab"] = "1"
			case "source":
				o.Epoch["sourceBlockHash"] = emptyRoot
			case "funding":
				o.Epoch["quoteAmount"] = "1"
			case "allocation":
				c.Dataset.TotalAllocated = "0"
			case "leaf":
				c.Dataset.Leaves[0].Amount = "999"
			case "path":
				c.Dataset.Leaves[0].Proof = []string{emptyRoot}
			case "index":
				c.Dataset.Leaves[0].Index = c.Dataset.LeafCount
			case "missing account":
				account = zero
			}
			got, err := proofForCandidate(c, o, account)
			if err == nil || got.Schema != "" {
				t.Fatal("unsafe proof returned", got, err)
			}
		})
	}
}
func TestProofFreshnessAndCapacity(t *testing.T) {
	service := NewProofService(nil, deployment.Manifest{}, nil)
	service.now = func() time.Time { return time.Unix(1000, 0) }
	for _, test := range []struct {
		time  string
		valid bool
	}{{"0x370", true}, {"0x36f", false}, {"0x3f7", true}, {"0x3f8", false}, {"bad", false}} {
		if service.fresh(chainrpc.Header{Timestamp: test.time}) != test.valid {
			t.Fatal(test)
		}
	}
	c, _ := claimFixture(t, 0)
	service.slots <- struct{}{}
	service.slots <- struct{}{}
	if _, err := service.ClaimProof(context.Background(), c.Input.MarketID, c.Input.EpochID, c.Dataset.Leaves[0].Account); !errors.Is(err, ErrProofUnavailable) {
		t.Fatal(err)
	}
	if _, err := service.ClaimProof(context.Background(), "bad", 1, zero); !errors.Is(err, ErrProofInput) {
		t.Fatal(err)
	}
}

func TestClaimFitsRemainingFunds(t *testing.T) {
	for _, tc := range []struct {
		claimed, amount string
		want            bool
	}{{"0", "10", true}, {"3", "7", true}, {"3", "8", false}, {"10", "1", false}, {"-1", "1", false}, {"0", "0", false}, {"bad", "1", false}} {
		if claimFits(tc.amount, map[string]any{"claimedAmount": tc.claimed, "quoteAmount": "10"}) != tc.want {
			t.Fatal(tc)
		}
	}
}
