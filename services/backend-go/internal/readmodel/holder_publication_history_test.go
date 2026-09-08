package readmodel

import (
	"fmt"
	"math/big"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
)

func TestHolderPublicationHistory(t *testing.T) {
	for _, mode := range []string{"valid", "missing publication", "duplicate", "early finalization", "root mismatch", "confirmation root mismatch", "dataset mismatch", "twab mismatch", "leaf mismatch", "delay mismatch", "before request", "after deadline", "zero delay", "empty", "empty wrong root", "nonempty zero deadline", "cancel", "cancel and republish", "cancel without new request", "cancel after finalization", "orphan cancel", "pending"} {
		t.Run(mode, func(t *testing.T) {
			id := "0x" + strings.Repeat("1", 64)
			d := "0x" + strings.Repeat("2", 40)
			topic := func(n int) string { return fmt.Sprintf("0x%064x", n) }
			pub := projection.Input{Module: "TreasuryDistributorV1", Log: chainrpc.Log{Address: d, Topics: []string{deployment.Hash([]byte("RootPublished(bytes32,uint32,bytes32,bytes32,uint256,uint32,uint64)")), id, topic(1), id}, Data: "0x" + id[2:] + fmt.Sprintf("%064x%064x%064x", 32, 1, 90)}}
			fin := pub
			fin.Log.Topics = []string{deployment.Hash([]byte("RootFinalized(bytes32,uint32,bytes32,uint64)")), id, topic(1), id}
			fin.Log.Data = topic(100)
			cancel := pub
			cancel.Log.Topics = []string{deployment.Hash([]byte("PendingRootCancelled(bytes32,uint32,bytes32)")), id, topic(1), id}
			cancel.Log.Data = "0x"
			v := map[string]string{"status": "3", "merkleRoot": id, "datasetHash": id, "totalTwab": "32", "leafCount": "1", "finalizeAfter": "90", "requestedAt": "60", "publishBy": "80", "claimUntil": "100", "claimedAmount": "0"}
			h := HolderMarketCandidate{Mode: "epoch", MarketID: id, Distributor: d, Epoch: &EpochHolderCandidate{Entries: []HolderEpochDetail{{Epoch: "1", Values: v}}}}
			ledger := newHolderClaimHistory()
			request := holderRequestInput(pub, v)
			if err := ledger.add(request, 60); err != nil {
				t.Fatal(err)
			}
			if mode == "missing publication" || mode == "orphan cancel" {
				in := fin
				if mode == "orphan cancel" {
					in = cancel
				}
				if ledger.add(in, 90) == nil {
					t.Fatal("missing publication accepted")
				}
				return
			}
			switch mode {
			case "zero delay":
				pub.Log.Data = "0x" + id[2:] + fmt.Sprintf("%064x%064x%064x", 32, 1, 70)
			case "empty", "empty wrong root":
				pub.Log.Data = "0x" + id[2:] + fmt.Sprintf("%064x%064x%064x", 0, 0, 90)
				if mode == "empty" {
					pub.Log.Topics[3] = emptyTreasuryRoot()
				}
				fin.Log.Topics[3] = pub.Log.Topics[3]
				fin.Log.Data = topic(0)
				v["status"] = "4"
				v["merkleRoot"] = pub.Log.Topics[3]
				v["totalTwab"] = "0"
				v["leafCount"] = "0"
				v["claimUntil"] = "0"
			}
			err := ledger.add(pub, 70)
			if mode == "zero delay" || mode == "empty wrong root" {
				if err == nil {
					t.Fatal("invalid publication accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if mode == "duplicate" {
				if ledger.add(pub, 70) == nil {
					t.Fatal("duplicate accepted")
				}
				return
			}
			if mode == "cancel" || mode == "cancel and republish" || mode == "cancel without new request" {
				if err := ledger.add(cancel, 75); err != nil {
					t.Fatal(err)
				}
				if mode == "cancel" {
					if ledger.add(fin, 90) == nil {
						t.Fatal("cancelled publication finalized")
					}
					return
				}
				if mode == "cancel without new request" {
					if ledger.add(pub, 76) == nil {
						t.Fatal("cancelled request reused")
					}
					return
				}
				v["requestedAt"] = "75"
				if err := ledger.add(request, 75); err != nil {
					t.Fatal(err)
				}
				if err := ledger.add(pub, 76); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "pending" {
				v["status"] = "2"
				v["claimUntil"] = "0"
			} else {
				at := uint64(90)
				if mode == "early finalization" {
					at = 89
				}
				if mode == "confirmation root mismatch" {
					fin.Log.Topics[3] = deployment.Hash([]byte("other confirmed root"))
				}
				if mode == "nonempty zero deadline" {
					fin.Log.Data = topic(0)
				}
				err := ledger.add(fin, at)
				if mode == "early finalization" || mode == "nonempty zero deadline" || mode == "confirmation root mismatch" {
					if err == nil {
						t.Fatal("invalid confirmation accepted")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			if mode == "cancel after finalization" {
				if ledger.add(cancel, 95) == nil {
					t.Fatal("confirmed cancellation accepted")
				}
				return
			}
			switch mode {
			case "root mismatch":
				v["merkleRoot"] = deployment.Hash([]byte("other"))
			case "dataset mismatch":
				v["datasetHash"] = deployment.Hash([]byte("other"))
			case "twab mismatch":
				v["totalTwab"] = "33"
			case "leaf mismatch":
				v["leafCount"] = "2"
			case "delay mismatch":
				v["finalizeAfter"] = "89"
			case "before request":
				v["requestedAt"] = "71"
			case "after deadline":
				v["publishBy"] = "69"
			}
			valid := mode == "valid" || mode == "empty" || mode == "cancel and republish" || mode == "pending"
			if err := ledger.verify([]HolderMarketCandidate{h}); (err == nil) != valid {
				t.Fatal(mode, err)
			}
		})
	}
}

// Populate the request portion of a minimal candidate and encode its ABI event.
func holderRequestInput(base projection.Input, v map[string]string) projection.Input {
	if base.Log.BlockNumber == "" {
		base.Log.BlockNumber = "0x2"
	}
	defaults := map[string]string{"windowstart": "1", "windowend": "51", "requester": "0x" + strings.Repeat("3", 40), "sourceBlockNumber": "1", "sourceBlockHash": "0x" + strings.Repeat("4", 64), "quoteAmount": "10", "serviceFeeAsset": "0x" + strings.Repeat("0", 40), "serviceFeeAmount": "1"}
	for k, value := range defaults {
		if _, ok := v[k]; !ok {
			v[k] = value
		}
	}
	word := func(s string) string {
		if strings.HasPrefix(s, "0x") {
			return strings.Repeat("0", 66-len(s)) + s[2:]
		}
		n, ok := new(big.Int).SetString(s, 10)
		if !ok {
			panic(s)
		}
		return fmt.Sprintf("%064x", n)
	}
	base.Log.Topics = []string{deployment.Hash([]byte("RootRequested(bytes32,uint32,address,uint64,uint64,uint64,bytes32,uint256,address,uint128,uint64)")), base.Log.Topics[1], base.Log.Topics[2], "0x" + word(v["requester"])}
	base.Log.Data = "0x"
	for _, field := range []string{"windowstart", "windowend", "sourceBlockNumber", "sourceBlockHash", "quoteAmount", "serviceFeeAsset", "serviceFeeAmount", "publishBy"} {
		base.Log.Data += word(v[field])
	}
	return base
}
