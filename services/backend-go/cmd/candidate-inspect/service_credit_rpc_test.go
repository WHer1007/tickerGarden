package main

import (
	"context"
	"math/big"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func TestCandidateServiceCreditRPC(t *testing.T) {
	for _, mode := range []string{"valid", "withdrawn zero", "mismatch", "missing RPC", "bad ABI", "wrong block", "missing history", "duplicate", "foreign distributor", "noncanonical", "budget"} {
		t.Run(mode, func(t *testing.T) {
			d := "0x" + strings.Repeat("2", 40)
			asset := "0x" + strings.Repeat("0", 40)
			beneficiary := "0x" + strings.Repeat("3", 40)
			hash := "0x" + strings.Repeat("4", 64)
			amount := "900719925474099312345"
			if mode == "withdrawn zero" {
				amount = "0"
			}
			c := readmodel.CandidateSet{BlockHash: hash, ServiceCreditHistoryVerified: true, HolderMarkets: []readmodel.HolderMarketCandidate{{Mode: "epoch", Distributor: d}}, ServiceCredits: []readmodel.ServiceCreditCandidate{{Distributor: d, Asset: asset, Beneficiary: beneficiary, Amount: amount}}}
			key := d + deployment.Hash([]byte("serviceCredit(address,address)"))[:10] + strings.Repeat("0", 24) + asset[2:] + strings.Repeat("0", 24) + beneficiary[2:]
			n, _ := new(big.Int).SetString(amount, 10)
			calls := map[string][]byte{key: n.FillBytes(make([]byte, 32))}
			switch mode {
			case "mismatch":
				c.ServiceCredits[0].Amount = "1"
			case "missing RPC":
				delete(calls, key)
			case "bad ABI":
				calls[key] = []byte{1}
			case "wrong block":
				c.BlockHash = "0x" + strings.Repeat("5", 64)
			case "missing history":
				c.ServiceCreditHistoryVerified = false
			case "duplicate":
				c.ServiceCredits = append(c.ServiceCredits, c.ServiceCredits[0])
			case "foreign distributor":
				c.ServiceCredits[0].Distributor = beneficiary
			case "noncanonical":
				c.ServiceCredits[0].Amount = "0" + amount
			case "budget":
				c.ServiceCredits = make([]readmodel.ServiceCreditCandidate, readmodel.MaxServiceCreditReads+1)
			}
			err := verifyCandidateServiceCredits(context.Background(), gaugeObserver{hash: hash, calls: calls}, c)
			if (err == nil) != (mode == "valid" || mode == "withdrawn zero") {
				t.Fatal(mode, err)
			}
		})
	}
}
