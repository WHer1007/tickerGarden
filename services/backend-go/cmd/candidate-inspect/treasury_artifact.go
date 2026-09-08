package main

import (
	"context"
	"errors"
	"reflect"
	"strconv"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/treasury"
)

// Production lookup validates artifact digest, recomputation and canonical
// source/request evidence. This layer binds that artifact to the inspected root
// and every replayed claim; it does not prove Transfer-history completeness.
func verifyCandidateTreasuryArtifacts(ctx context.Context, lookup treasury.CandidateLookup, c readmodel.CandidateSet) error {
	bad := errors.New("candidate Treasury artifact or claim proof unavailable")
	if len(c.TreasuryClaims) > 100000 {
		return bad
	}
	key := func(d, m, e string) string { return d + ":" + m + ":" + e }
	claims := map[string][]readmodel.TreasuryClaimCandidate{}
	for _, claim := range c.TreasuryClaims {
		k := key(claim.Distributor, claim.MarketID, claim.Epoch)
		claims[k] = append(claims[k], claim)
	}
	seen := map[string]bool{}
	roots := 0
	for _, holder := range c.HolderMarkets {
		if holder.Mode != "epoch" {
			continue
		}
		if holder.Epoch == nil || !c.TreasuryClaimHistoryVerified {
			return bad
		}
		for _, entry := range holder.Epoch.Entries {
			v := entry.Values
			k := key(holder.Distributor, holder.MarketID, entry.Epoch)
			if seen[k] {
				return bad
			}
			seen[k] = true
			if v["status"] == "0" || v["status"] == "1" {
				if len(claims[k]) > 0 {
					return bad
				}
				continue
			}
			if v["status"] != "2" && v["status"] != "3" && v["status"] != "4" {
				return bad
			}
			roots++
			if roots > deployment.MaxHolderEpochReads || lookup == nil || ctx.Err() != nil {
				return bad
			}
			epoch, err := strconv.ParseUint(entry.Epoch, 10, 32)
			if err != nil || epoch == 0 {
				return bad
			}
			artifact, err := lookup.Find(ctx, c.ChainID, holder.MarketID, uint32(epoch), v["datasetHash"])
			if err != nil || !artifact.Journal.ReceiptRootVerified {
				return bad
			}
			computed, err := treasury.Generate(artifact.Input)
			if err != nil || !reflect.DeepEqual(computed, artifact.Dataset) {
				return bad
			}
			expected := treasury.Context{ChainID: strconv.FormatUint(c.ChainID, 10), Distributor: holder.Distributor, MarketID: holder.MarketID, EpochID: uint32(epoch), MemeToken: holder.MemeToken, QuoteToken: holder.QuoteAsset, EligibilityPolicyHash: holder.Epoch.EligibilityPolicyHash, WindowStart: v["windowstart"], WindowEnd: v["windowend"], SourceBlockNumber: v["sourceBlockNumber"], SourceBlockHash: v["sourceBlockHash"]}
			if computed.Context != expected || artifact.Input.QuoteAmount != v["quoteAmount"] || computed.MerkleRoot != v["merkleRoot"] || computed.DatasetHash != v["datasetHash"] || computed.TotalTwab != v["totalTwab"] || strconv.FormatUint(uint64(computed.LeafCount), 10) != v["leafCount"] {
				return bad
			}
			if v["status"] == "2" && len(claims[k]) > 0 {
				return bad
			}
			for _, claim := range claims[k] {
				index, err := strconv.ParseUint(claim.LeafIndex, 10, 32)
				if err != nil || strconv.FormatUint(index, 10) != claim.LeafIndex || index >= uint64(len(computed.Leaves)) {
					return bad
				}
				leaf := computed.Leaves[index]
				if uint64(leaf.Index) != index || leaf.Account != claim.Account || leaf.Twab != claim.Twab || leaf.Amount != claim.Amount {
					return bad
				}
				digest, err := treasury.HashLeaf(expected, uint32(index), claim.Account, claim.Twab, claim.Amount)
				if err != nil || digest != leaf.Leaf || !treasury.VerifyProof(digest, leaf.Proof, computed.MerkleRoot) {
					return bad
				}
			}
			delete(claims, k)
		}
	}
	if len(claims) > 0 || ctx.Err() != nil {
		return bad
	}
	return nil
}
