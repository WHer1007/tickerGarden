package readmodel

import (
	"fmt"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
)

func TestHolderRequestHistory(t *testing.T) {
	for _, mode := range []string{"valid", "missing", "duplicate", "expired", "expiry boundary", "expiry after publication", "wrong refund beneficiary", "retry", "zero fee", "zero funding", "window open", "zero window", "publication missing request", "publication expired", "requestedAt", "requester", "sourceBlockNumber", "sourceBlockHash", "quoteAmount", "serviceFeeAsset", "serviceFeeAmount", "publishBy", "windowstart", "windowend"} {
		t.Run(mode, func(t *testing.T) {
			id := "0x" + strings.Repeat("1", 64)
			d := "0x" + strings.Repeat("2", 40)
			base := projection.Input{Module: "TreasuryDistributorV1", Log: chainrpc.Log{Address: d, Topics: []string{"", id, fmt.Sprintf("0x%064x", 1)}}}
			v := map[string]string{"status": "1", "claimedAmount": "0", "requestedAt": "60", "publishBy": "80"}
			req := holderRequestInput(base, v)
			switch mode {
			case "zero fee":
				v["serviceFeeAmount"] = "0"
			case "zero funding":
				v["quoteAmount"] = "0"
			case "window open":
				v["windowend"] = "61"
			case "zero window":
				v["publishBy"] = "60"
			}
			req = holderRequestInput(base, v)
			h := HolderMarketCandidate{Mode: "epoch", MarketID: id, Distributor: d, Epoch: &EpochHolderCandidate{Entries: []HolderEpochDetail{{Epoch: "1", Values: v}}}}
			ledger := newHolderClaimHistory()
			if mode == "missing" {
				if ledger.verify([]HolderMarketCandidate{h}) == nil {
					t.Fatal("unbacked request accepted")
				}
				return
			}
			pub := base
			pub.Log.Topics = []string{deployment.Hash([]byte("RootPublished(bytes32,uint32,bytes32,bytes32,uint256,uint32,uint64)")), id, base.Log.Topics[2], id}
			pub.Log.Data = "0x" + id[2:] + fmt.Sprintf("%064x%064x%064x", 32, 1, 90)
			if mode == "publication missing request" {
				if ledger.add(pub, 70) == nil {
					t.Fatal("unrequested publication accepted")
				}
				return
			}
			err := ledger.add(req, 60)
			if mode == "zero fee" || mode == "zero funding" || mode == "window open" || mode == "zero window" {
				if err == nil {
					t.Fatal("invalid request accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if mode == "duplicate" {
				if ledger.add(req, 60) == nil {
					t.Fatal("duplicate request accepted")
				}
				return
			}
			if mode == "publication expired" {
				if ledger.add(pub, 81) == nil {
					t.Fatal("late publication accepted")
				}
				return
			}
			if mode == "expired" || mode == "expiry after publication" || mode == "expiry boundary" || mode == "wrong refund beneficiary" || mode == "retry" {
				expiry := base
				expiry.Log.Topics = []string{deployment.Hash([]byte("RootRequestExpired(bytes32,uint32,address)")), id, base.Log.Topics[2], req.Log.Topics[3]}
				expiry.Log.Data = "0x"
				if mode == "wrong refund beneficiary" {
					expiry.Log.Topics[3] = fmt.Sprintf("0x%064x", 9)
				}
				at := uint64(81)
				if mode == "expiry boundary" {
					at = 80
				}
				if mode == "expiry after publication" {
					if err := ledger.add(pub, 70); err != nil {
						t.Fatal(err)
					}
				}
				err := ledger.add(expiry, at)
				if mode == "expiry after publication" || mode == "expiry boundary" || mode == "wrong refund beneficiary" {
					if err == nil {
						t.Fatal("invalid expiry accepted")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				if mode == "retry" {
					v["requestedAt"] = "81"
					v["publishBy"] = "101"
					req = holderRequestInput(base, v)
					if err := ledger.add(req, 81); err != nil {
						t.Fatal(err)
					}
				} else {
					v["status"] = "0"
				}
			} else if mode != "valid" {
				v[mode] = "999"
			}
			valid := mode == "valid" || mode == "expired" || mode == "retry"
			if err := ledger.verify([]HolderMarketCandidate{h}); (err == nil) != valid {
				t.Fatal(mode, err)
			}
		})
	}
}
