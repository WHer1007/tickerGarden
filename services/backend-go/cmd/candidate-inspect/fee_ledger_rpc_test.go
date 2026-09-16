package main

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/feeledger"
	"tickergarden/backend/internal/readmodel"
)

func TestEventFeeLedgerRPC(t *testing.T) {
	for _, mode := range []string{"valid", "surplus", "native", "native underfunded", "coherent bucket shift", "missing evidence", "missing report", "mismatched report", "wrong chain", "wrong block", "wrong start", "unverified history", "missing probe", "extra probe", "duplicate probe", "invalid expected", "wrong comparison", "forged matched", "rpc failure"} {
		t.Run(mode, func(t *testing.T) {
			h := "0x" + strings.Repeat("1", 64)
			id := "0x" + strings.Repeat("5", 64)
			quote := "0x" + strings.Repeat("2", 40)
			meme := "0x" + strings.Repeat("3", 40)
			vault := "0x" + strings.Repeat("4", 40)
			native := strings.HasPrefix(mode, "native")
			if native {
				quote = "0x" + strings.Repeat("0", 40)
			}
			unit, _ := new(big.Int).SetString("900719925474099312345", 10)
			total := new(big.Int).Mul(unit, big.NewInt(5))
			c := readmodel.CandidateSet{ChainID: 46630, BlockNumber: "10", BlockHash: h, HistoryStartBlock: 1, HistoryReceiptRootsVerified: true, ProtocolEventInventoryVerified: true, EmitterAddressBindingsVerified: true, Markets: []readmodel.MarketReadModel{{MarketID: id, QuoteAsset: quote, MemeToken: meme}}}
			report := feeledger.Report{Scope: "fee-liabilities-v1", MatchesKnownLiabilities: true, Expected: 18, Completed: 18}
			putProbe := func(kind, key, field, expected, comparison string) {
				actual := expected
				report.Probes = append(report.Probes, feeledger.Probe{Kind: kind, Key: key, Field: field, Expected: expected, Actual: &actual, Comparison: comparison, Status: "matched"})
			}
			calls := map[string][]byte{}
			put := func(a, sig, args string, value *big.Int) {
				calls[a+deployment.Hash([]byte(sig))[:10]+args] = value.FillBytes(make([]byte, 32))
			}
			for _, asset := range []string{quote, meme} {
				args := id[2:] + strings.Repeat("0", 24) + asset[2:]
				for bucket, field := range []string{"creator", "staker", "platform", "holder", "forfeitureReserve"} {
					sig := "liability(bytes32,address,uint8)"
					callArgs := args + fmt.Sprintf("%064x", bucket)
					if bucket == 4 {
						sig = "forfeitureReserve(bytes32,address)"
						callArgs = args
					}
					put(vault, sig, callArgs, unit)
					putProbe("feeLiability", id+":"+asset, field, unit.String(), "equal")
				}
				putProbe("feeLiability", id+":"+asset, "bucketAndReserveTotal", total.String(), "equal")
				for _, field := range []string{"totalLiability", "knownMarketLiabilitySum", "balance"} {
					comparison := "equal"
					if field == "balance" {
						comparison = "atLeast"
					}
					putProbe("feeSolvency", asset, field, total.String(), comparison)
				}
				put(vault, "totalLiability(address)", strings.Repeat("0", 24)+asset[2:], total)
				put(asset, "balanceOf(address)", strings.Repeat("0", 24)+vault[2:], total)
			}
			c.FeeReconciliation = &readmodel.FeeReconciliationCandidate{Status: "matched", ChainID: c.ChainID, StartBlock: c.HistoryStartBlock, BlockNumber: c.BlockNumber, BlockHash: c.BlockHash, Report: &report}
			switch mode {
			case "surplus":
				put(quote, "balanceOf(address)", strings.Repeat("0", 24)+vault[2:], new(big.Int).Add(total, big.NewInt(1)))
			case "coherent bucket shift":
				args := id[2:] + strings.Repeat("0", 24) + quote[2:]
				put(vault, "liability(bytes32,address,uint8)", args+fmt.Sprintf("%064x", 0), new(big.Int).Add(unit, big.NewInt(1)))
				put(vault, "liability(bytes32,address,uint8)", args+fmt.Sprintf("%064x", 1), new(big.Int).Sub(unit, big.NewInt(1)))
			case "missing report":
				c.FeeReconciliation.Report = nil
			case "mismatched report":
				c.FeeReconciliation.Status = "mismatch"
			case "missing evidence":
				c.FeeReconciliation = nil
			case "wrong chain":
				c.FeeReconciliation.ChainID++
			case "wrong block":
				c.FeeReconciliation.BlockHash = id
			case "wrong start":
				c.FeeReconciliation.StartBlock++
			case "unverified history":
				c.HistoryReceiptRootsVerified = false
			case "missing probe":
				report.Probes = report.Probes[1:]
				report.Expected--
				report.Completed--
			case "extra probe":
				p := report.Probes[0]
				p.Key = "unknown"
				report.Probes = append(report.Probes, p)
				report.Expected++
				report.Completed++
			case "duplicate probe":
				report.Probes[1] = report.Probes[0]
			case "invalid expected":
				report.Probes[0].Expected = "01"
			case "wrong comparison":
				report.Probes[0].Comparison = "atLeast"
			case "forged matched":
				actual := "0"
				report.Probes[0].Actual = &actual
			case "rpc failure":
				delete(calls, vault+deployment.Hash([]byte("totalLiability(address)"))[:10]+strings.Repeat("0", 24)+quote[2:])
			}
			manifest := deployment.Manifest{Contracts: []deployment.Contract{{Module: "ProtocolFeeVault", Address: vault}}}
			observer := gaugeObserver{hash: h, calls: calls}
			var rpc deployment.BindingObserver = observer
			if native {
				balance := total.String()
				if mode == "native underfunded" {
					balance = "0"
				}
				rpc = nativeFeeObserver{gaugeObserver: observer, balance: balance}
			}
			valid := mode == "valid" || mode == "surplus" || mode == "native"
			if mode == "coherent bucket shift" {
				if err := verifyCandidateFeeCoverage(context.Background(), observer, manifest, c); err != nil {
					t.Fatal("getter-only control", err)
				}
			}
			if err := verifyCandidateFeeLedgerRPC(context.Background(), rpc, manifest, c); (err == nil) != valid {
				t.Fatal(mode, err)
			}
			if native {
				return
			}
			client, count := stateHTTPFixture(t, h, observer)
			if err := verifyCandidateFeeLedgerRPC(context.Background(), client, manifest, c); (err == nil) != valid {
				t.Fatal("HTTP", mode, err)
			}
			if valid && count.Load() != 14 {
				t.Fatal("RPC coverage", count.Load())
			}
		})
	}
}
