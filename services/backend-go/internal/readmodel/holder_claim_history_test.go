package readmodel

import (
	"fmt"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
)

func TestHolderClaimHistory(t *testing.T) {
	for _, mode := range []string{"valid", "unfinalized claim", "duplicate finalization", "finalized root mismatch", "empty root claim", "early claim", "late claim", "self claim", "leaf out of range", "missing", "wrong sum", "wrong distributor", "duplicate leaf", "duplicate account", "second claim", "unknown epoch", "zero amount"} {
		t.Run(mode, func(t *testing.T) {
			id := "0x" + strings.Repeat("1", 64)
			d := "0x" + strings.Repeat("2", 40)
			account := strings.Repeat("3", 40)
			input := projection.Input{Module: "TreasuryDistributorV1", Log: chainrpc.Log{Address: d, Topics: []string{deployment.Hash([]byte("TreasuryClaimed(bytes32,uint32,uint256,address,uint256,uint256)")), id, fmt.Sprintf("0x%064x", 1), fmt.Sprintf("0x%064x", 0)}, Data: "0x" + strings.Repeat("0", 24) + account + fmt.Sprintf("%064x%064x", 32, 3)}}
			h := HolderMarketCandidate{Mode: "epoch", MarketID: id, Distributor: d, Epoch: &EpochHolderCandidate{Entries: []HolderEpochDetail{{Epoch: "1", Values: map[string]string{"claimedAmount": "3", "leafCount": "1", "finalizeAfter": "90", "claimUntil": "100", "status": "3", "merkleRoot": id, "datasetHash": id, "totalTwab": "32", "requestedAt": "60", "publishBy": "80"}}}}}
			ledger := newHolderClaimHistory()
			if err := ledger.add(holderRequestInput(input, h.Epoch.Entries[0].Values), 60); err != nil {
				t.Fatal(err)
			}
			finalized := input
			finalized.Log = input.Log
			finalized.Log.Topics = []string{deployment.Hash([]byte("RootFinalized(bytes32,uint32,bytes32,uint64)")), id, fmt.Sprintf("0x%064x", 1), id}
			finalized.Log.Data = fmt.Sprintf("0x%064x", 100)
			if mode == "unfinalized claim" {
				if ledger.add(input, 100) == nil {
					t.Fatal("claim before finalization accepted")
				}
				return
			}
			publication := input
			publication.Log.Topics = []string{deployment.Hash([]byte("RootPublished(bytes32,uint32,bytes32,bytes32,uint256,uint32,uint64)")), id, fmt.Sprintf("0x%064x", 1), id}
			leafCount := 1
			if mode == "second claim" {
				leafCount = 2
				h.Epoch.Entries[0].Values["leafCount"] = "2"
			}
			publication.Log.Data = "0x" + id[2:] + fmt.Sprintf("%064x%064x%064x", 32, leafCount, 90)
			if mode == "empty root claim" {
				publication.Log.Topics[3] = emptyTreasuryRoot()
				publication.Log.Data = "0x" + id[2:] + fmt.Sprintf("%064x%064x%064x", 0, 0, 90)
				finalized.Log.Topics[3] = emptyTreasuryRoot()
				finalized.Log.Data = fmt.Sprintf("0x%064x", 0)
			}
			if e := ledger.add(publication, 70); e != nil {
				t.Fatal(e)
			}
			if e := ledger.add(finalized, 90); e != nil {
				t.Fatal(e)
			}

			if mode == "duplicate finalization" {
				if ledger.add(finalized, 90) == nil {
					t.Fatal("duplicate finalization accepted")
				}
				return
			}
			if mode == "finalized root mismatch" {
				h.Epoch.Entries[0].Values["merkleRoot"] = deployment.Hash([]byte("wrong root"))
			}
			switch mode {
			case "early claim":
				h.Epoch.Entries[0].Values["finalizeAfter"] = "101"
			case "late claim":
				h.Epoch.Entries[0].Values["claimUntil"] = "99"
			case "self claim":
				input.Log.Data = "0x" + strings.Repeat("0", 24) + d[2:] + fmt.Sprintf("%064x%064x", 32, 3)
			case "leaf out of range":
				input.Log.Topics[3] = fmt.Sprintf("0x%064x", 1)
			case "missing":
				if ledger.verify([]HolderMarketCandidate{h}) == nil {
					t.Fatal("missing claim accepted")
				}
				return
			case "wrong sum":
				h.Epoch.Entries[0].Values["claimedAmount"] = "4"
			case "wrong distributor":
				h.Distributor = "0x" + strings.Repeat("4", 40)
			case "unknown epoch":
				input.Log.Topics[2] = fmt.Sprintf("0x%064x", 2)
			case "zero amount":
				input.Log.Data = "0x" + strings.Repeat("0", 24) + account + fmt.Sprintf("%064x%064x", 32, 0)
			}
			e := ledger.add(input, 100)
			if mode == "zero amount" || mode == "self claim" || mode == "unknown epoch" || mode == "empty root claim" {
				if e == nil {
					t.Fatal("zero accepted")
				}
				return
			}
			if e != nil {
				t.Fatal(e)
			}
			if mode == "duplicate leaf" || mode == "duplicate account" || mode == "second claim" {
				if mode != "duplicate leaf" {
					input.Log.Topics[3] = fmt.Sprintf("0x%064x", 1)
				}
				if mode == "second claim" {
					input.Log.Data = "0x" + strings.Repeat("0", 24) + strings.Repeat("4", 40) + fmt.Sprintf("%064x%064x", 32, 3)
					h.Epoch.Entries[0].Values["claimedAmount"] = "6"
					h.Epoch.Entries[0].Values["leafCount"] = "2"
				}
				e = ledger.add(input, 100)
				if mode != "second claim" {
					if e == nil {
						t.Fatal("duplicate accepted")
					}
					return
				}
				if e != nil {
					t.Fatal(e)
				}
			}
			valid := mode == "valid" || mode == "second claim"
			if e := ledger.verify([]HolderMarketCandidate{h}); (e == nil) != valid {
				t.Fatal(mode, e)
			}
		})
	}
}
