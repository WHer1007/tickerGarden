package readmodel

import (
	"fmt"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
)

func TestHolderStreamHistory(t *testing.T) {
	for _, mode := range []string{"valid", "funding timestamp mismatch", "registered empty", "missing registration", "duplicate registration", "wrong token", "multiple claims", "missing funding", "missing claim", "wrong asset", "wrong distributor", "wrong funded", "wrong paid", "wrong time", "excess claim", "zero funding", "backwards funding"} {
		t.Run(mode, func(t *testing.T) {
			id := "0x" + strings.Repeat("1", 64)
			d := "0x" + strings.Repeat("2", 40)
			q := "0x" + strings.Repeat("3", 40)
			fund := projection.Input{Module: "HolderRewardsDistributorV1", Log: chainrpc.Log{Address: d, Topics: []string{deployment.Hash([]byte("HolderStreamFunded(bytes32,uint256,uint64)")), id}, Data: fmt.Sprintf("0x%064x%064x", 10, 86500)}}
			claim := projection.Input{Module: fund.Module, Log: chainrpc.Log{Address: d, Topics: []string{deployment.Hash([]byte("HolderStreamClaimed(bytes32,address,address,uint256)")), id, "0x" + strings.Repeat("0", 24) + d[2:]}, Data: "0x" + strings.Repeat("0", 24) + q[2:] + fmt.Sprintf("%064x", 3)}}
			holder := HolderMarketCandidate{MemeToken: d, Mode: "continuous-24h", MarketID: id, Distributor: d, QuoteAsset: q, Continuous: &ContinuousHolderCandidate{Funded: "10", Paid: "3", LastFundingAt: "100"}}
			ledger := newHolderStreamHistory()
			registration := projection.Input{Module: fund.Module, Log: chainrpc.Log{Address: d, Topics: []string{deployment.Hash([]byte("HolderStreamMarketRegistered(bytes32,address,address,address)")), id, "0x" + strings.Repeat("0", 24) + d[2:]}, Data: "0x" + strings.Repeat("0", 24) + q[2:] + strings.Repeat("0", 24) + d[2:]}}
			if mode == "missing registration" {
				if ledger.add(fund, 100) == nil {
					t.Fatal("unregistered funding accepted")
				}
				return
			}
			if e := ledger.add(registration, 100); e != nil {
				t.Fatal(e)
			}
			if mode == "registered empty" {
				holder.Continuous.Funded = "0"
				holder.Continuous.Paid = "0"
				holder.Continuous.LastFundingAt = "0"
				if e := ledger.verify([]HolderMarketCandidate{holder}); e != nil {
					t.Fatal(e)
				}
				return
			}
			if mode == "duplicate registration" {
				if ledger.add(registration, 100) == nil {
					t.Fatal("duplicate registration accepted")
				}
				return
			}
			if mode == "wrong token" {
				holder.MemeToken = "0x" + strings.Repeat("4", 40)
			}

			if mode == "funding timestamp mismatch" {
				fund.Log.Data = fmt.Sprintf("0x%064x%064x", 10, 86501)
				if ledger.add(fund, 100) == nil {
					t.Fatal("funding end not bound to header")
				}
				return
			}
			if mode == "zero funding" {
				fund.Log.Data = fmt.Sprintf("0x%064x%064x", 0, 86500)
			}
			if mode != "missing funding" {
				e := ledger.add(fund, 100)
				if mode == "zero funding" {
					if e == nil {
						t.Fatal("zero accepted")
					}
					return
				}
				if e != nil {
					t.Fatal(e)
				}
			}
			if mode == "backwards funding" {
				fund.Log.Data = fmt.Sprintf("0x%064x%064x", 10, 86499)
				if ledger.add(fund, 100) == nil {
					t.Fatal("backwards funding accepted")
				}
				return
			}
			if mode == "excess claim" {
				claim.Log.Data = "0x" + strings.Repeat("0", 24) + q[2:] + fmt.Sprintf("%064x", 11)
			}
			if mode != "missing claim" {
				e := ledger.add(claim, 100)
				if mode == "missing funding" || mode == "excess claim" {
					if e == nil {
						t.Fatal("unfunded claim accepted")
					}
					return
				}
				if e != nil {
					t.Fatal(e)
				}
			}
			switch mode {
			case "multiple claims":
				if e := ledger.add(claim, 100); e != nil {
					t.Fatal(e)
				}
				holder.Continuous.Paid = "6"
			case "wrong asset":
				holder.QuoteAsset = d
			case "wrong distributor":
				holder.Distributor = q
			case "wrong funded":
				holder.Continuous.Funded = "11"
			case "wrong paid":
				holder.Continuous.Paid = "2"
			case "wrong time":
				holder.Continuous.LastFundingAt = "99"
			}
			valid := mode == "valid" || mode == "multiple claims"
			if e := ledger.verify([]HolderMarketCandidate{holder}); (e == nil) != valid {
				t.Fatal(mode, e)
			}
		})
	}
}
