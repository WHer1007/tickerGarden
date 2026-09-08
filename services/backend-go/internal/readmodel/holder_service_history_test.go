package readmodel

import (
	"fmt"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
)

func TestHolderServiceHistory(t *testing.T) {
	for _, mode := range []string{"pending", "expired", "withdrawn", "cancelled", "finalized", "retry", "short liability", "missing asset", "premature withdrawal", "excess withdrawal", "double withdrawal", "zero withdrawal", "wrong beneficiary withdrawal", "partial withdrawal", "treasury withdrawal", "requester steals treasury withdrawal"} {
		t.Run(mode, func(t *testing.T) {
			id := "0x" + strings.Repeat("1", 64)
			d := "0x" + strings.Repeat("2", 40)
			native := "0x" + strings.Repeat("0", 40)
			topic := func(n int) string { return fmt.Sprintf("0x%064x", n) }
			base := projection.Input{Module: "TreasuryDistributorV1", Log: chainrpc.Log{Address: d, Topics: []string{"", id, topic(1)}}}
			v := map[string]string{"requestedAt": "60", "publishBy": "80"}
			req := holderRequestInput(base, v)
			if mode == "partial withdrawal" {
				v["serviceFeeAmount"] = "2"
				req = holderRequestInput(base, v)
			}
			ledger := newHolderClaimHistory()
			if err := ledger.add(req, 60); err != nil {
				t.Fatal(err)
			}
			expected := "1"
			if mode != "pending" && mode != "premature withdrawal" {
				if mode == "cancelled" || mode == "finalized" || mode == "treasury withdrawal" || mode == "requester steals treasury withdrawal" {
					pub := base
					pub.Log.Topics = []string{deployment.Hash([]byte("RootPublished(bytes32,uint32,bytes32,bytes32,uint256,uint32,uint64)")), id, topic(1), id}
					pub.Log.Data = "0x" + id[2:] + fmt.Sprintf("%064x%064x%064x", 32, 1, 90)
					if err := ledger.add(pub, 70); err != nil {
						t.Fatal(err)
					}
					event := base
					event.Log.Topics = []string{deployment.Hash([]byte("PendingRootCancelled(bytes32,uint32,bytes32)")), id, topic(1), id}
					event.Log.Data = "0x"
					if mode == "finalized" || mode == "treasury withdrawal" || mode == "requester steals treasury withdrawal" {
						event.Log.Topics[0] = deployment.Hash([]byte("RootFinalized(bytes32,uint32,bytes32,uint64)"))
						event.Log.Data = topic(100)
					}
					if err := ledger.add(event, 90); err != nil {
						t.Fatal(err)
					}
				} else {
					expiry := base
					expiry.Log.Topics = []string{deployment.Hash([]byte("RootRequestExpired(bytes32,uint32,address)")), id, topic(1), req.Log.Topics[3]}
					expiry.Log.Data = "0x"
					if err := ledger.add(expiry, 81); err != nil {
						t.Fatal(err)
					}
				}
			}
			if mode == "retry" {
				v["publishBy"] = "110"
				if err := ledger.add(holderRequestInput(base, v), 90); err != nil {
					t.Fatal(err)
				}
				expected = "2" // The refunded credit remains owed after a fresh fee is collected.
			}
			if strings.Contains(mode, "withdraw") {
				withdrawal := base
				withdrawal.Log.Topics = []string{deployment.Hash([]byte("ServiceCreditWithdrawn(address,address,uint256)")), topic(0), req.Log.Topics[3]}
				withdrawal.Log.Data = topic(1)
				if mode == "wrong beneficiary withdrawal" {
					withdrawal.Log.Topics[2] = topic(9)
				}
				if mode == "treasury withdrawal" {
					withdrawal.Log.Topics[2] = "0x" + strings.Repeat("0", 24) + strings.Repeat("7", 40)
				}
				if mode == "zero withdrawal" {
					withdrawal.Log.Data = topic(0)
				}
				if mode == "excess withdrawal" {
					withdrawal.Log.Data = topic(2)
				}
				err := ledger.add(withdrawal, 90)
				if mode == "premature withdrawal" || mode == "excess withdrawal" || mode == "zero withdrawal" {
					if err == nil {
						t.Fatal("invalid withdrawal accepted")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				expected = "0"
				if mode == "partial withdrawal" {
					expected = "1"
				}
				if mode == "double withdrawal" {
					if ledger.add(withdrawal, 91) == nil {
						t.Fatal("double withdrawal accepted")
					}
					return
				}
			}
			holders := []HolderMarketCandidate{{Mode: "epoch", Distributor: d, Epoch: &EpochHolderCandidate{RootServiceTreasury: "0x7777777777777777777777777777777777777777"}}}
			batch := deployment.ObservationBatch{Observations: []deployment.StateObservation{{Kind: "treasurySolvency", Key: d + ":" + native, Value: map[string]any{"treasuryDistributor": d, "asset": native, "totalServiceLiability": expected}}}}
			if mode == "short liability" {
				batch.Observations[0].Value["totalServiceLiability"] = "0"
			}
			if mode == "missing asset" {
				batch.Observations = nil
			}
			valid := mode != "short liability" && mode != "missing asset" && mode != "wrong beneficiary withdrawal" && mode != "partial withdrawal" && mode != "requester steals treasury withdrawal"
			if err := ledger.verifyServiceLiability(holders, batch); (err == nil) != valid {
				t.Fatal(mode, err)
			}
			if valid {
				if mode == "pending" {
					if len(ledger.creditCandidates) != 0 {
						t.Fatal("pending credit released")
					}
				} else {
					want := expected
					if mode == "retry" {
						want = "1"
					}
					if len(ledger.creditCandidates) != 1 || ledger.creditCandidates[0].Amount != want {
						t.Fatal("credit export", ledger.creditCandidates)
					}
				}
			}
		})
	}
}
