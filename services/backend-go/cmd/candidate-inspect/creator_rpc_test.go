package main

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

type creatorObserver struct{ gaugeObserver }

func (f creatorObserver) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	if tag != "0x1" {
		return chainrpc.Header{}, fmt.Errorf("unexpected block")
	}
	return chainrpc.Header{Number: tag, Hash: f.hash, ParentHash: f.hash, Timestamp: "0x64"}, nil
}
func TestCandidateCreatorEpochRPC(t *testing.T) {
	for _, mode := range []string{"valid", "same beneficiary", "zero beneficiary", "wrong registry", "wrong factory", "manifest mismatch", "zero epochs", "budget", "quote mismatch", "meme mismatch", "missing epoch", "bad ABI", "candidate missing", "candidate beneficiary", "candidate redistribution", "candidate extra", "observed mismatch", "observed malformed"} {
		t.Run(mode, func(t *testing.T) {
			addr := func(s string) string { return "0x" + strings.Repeat(s, 40) }
			h := "0x" + strings.Repeat("1", 64)
			vault, creator, factory, registry, quote, meme := addr("2"), addr("3"), addr("4"), addr("5"), addr("6"), addr("7")
			calls := map[string][]byte{}
			put := func(a, sig, args, value string) {
				n, ok := new(big.Int).SetString(strings.TrimPrefix(value, "0x"), 16)
				if !ok {
					t.Fatal(value)
				}
				calls[a+deployment.Hash([]byte(sig))[:10]+args] = n.FillBytes(make([]byte, 32))
			}
			put(vault, "creatorRevenueRegistry()", "", creator)
			put(vault, "marketRegistry()", "", registry)
			put(creator, "marketRegistry()", "", registry)
			put(creator, "factory()", "", factory)
			if mode == "wrong registry" {
				put(vault, "marketRegistry()", "", quote)
			}
			if mode == "wrong factory" {
				put(creator, "factory()", "", quote)
			}
			count := "2"
			if mode == "zero epochs" {
				count = "0"
			}
			if mode == "budget" {
				count = "401"
			}
			put(creator, "currentCreatorEpoch(bytes32)", h[2:], count)
			for epoch := 1; epoch <= 2; epoch++ {
				args := h[2:] + fmt.Sprintf("%064x", epoch)
				beneficiary := addr("8")
				if epoch == 2 && mode != "same beneficiary" {
					beneficiary = addr("9")
				}
				if mode == "zero beneficiary" && epoch == 2 {
					beneficiary = addr("0")
				}
				put(creator, "creatorBeneficiaryAt(bytes32,uint32)", args, beneficiary)
				for _, asset := range []string{quote, meme} {
					keyargs := args + strings.Repeat("0", 24) + asset[2:]
					// Distinct epochs, amounts above JS safe integer range.
					put(vault, "creatorLiability(bytes32,uint32,address)", keyargs, fmt.Sprintf("2000000000000%d", epoch))
					key := vault + deployment.Hash([]byte("creatorLiability(bytes32,uint32,address)"))[:10] + keyargs
					if mode == "missing epoch" && epoch == 2 {
						delete(calls, key)
					}
					if mode == "bad ABI" && epoch == 2 {
						calls[key] = []byte{1}
					}
				}
			}
			for _, asset := range []string{quote, meme} {
				total := "40000000000003"
				if (mode == "quote mismatch" && asset == quote) || (mode == "meme mismatch" && asset == meme) {
					total = "40000000000004"
				}
				put(vault, "liability(bytes32,address,uint8)", h[2:]+strings.Repeat("0", 24)+asset[2:]+strings.Repeat("0", 64), total)
			}
			m := deployment.Manifest{Contracts: []deployment.Contract{{Module: "ProtocolFeeVault", Address: vault}, {Module: "MarketRegistryV1", Address: registry}, {Module: "TickerGardenFactoryV1", Address: factory}}}
			if mode == "manifest mismatch" {
				m.Contracts = append(m.Contracts, deployment.Contract{Module: "CreatorRevenueRegistry", Address: quote})
			}
			c := readmodel.CandidateSet{BlockNumber: "1", BlockHash: h, Markets: []readmodel.MarketReadModel{{MarketID: h, QuoteAsset: quote, MemeToken: meme}}}
			for epoch := 1; epoch <= 2; epoch++ {
				beneficiary := addr("8")
				if epoch == 2 && mode != "same beneficiary" {
					beneficiary = addr("9")
				}
				amount, _ := new(big.Int).SetString(fmt.Sprintf("2000000000000%d", epoch), 16)
				c.CreatorEpochs = append(c.CreatorEpochs, readmodel.CreatorEpochCandidate{ObservedAtTimestamp: "100", MarketID: h, Epoch: fmt.Sprint(epoch), Beneficiary: beneficiary, QuoteAsset: quote, MemeAsset: meme, QuoteLiability: amount.String(), MemeLiability: amount.String()})
			}
			if mode == "candidate missing" {
				c.CreatorEpochs = c.CreatorEpochs[:1]
			}
			if mode == "candidate beneficiary" {
				c.CreatorEpochs[0].Beneficiary = quote
			}
			if mode == "candidate redistribution" {
				c.CreatorEpochs[0].QuoteLiability, c.CreatorEpochs[1].QuoteLiability = c.CreatorEpochs[1].QuoteLiability, c.CreatorEpochs[0].QuoteLiability
			}
			if mode == "candidate extra" {
				extra := c.CreatorEpochs[0]
				extra.Epoch = "3"
				c.CreatorEpochs = append(c.CreatorEpochs, extra)
			}
			if mode == "observed mismatch" {
				c.CreatorEpochs[0].ObservedAtTimestamp = "101"
			}
			if mode == "observed malformed" {
				c.CreatorEpochs[0].ObservedAtTimestamp = "0100"
			}
			f := creatorObserver{gaugeObserver{hash: h, calls: calls}}
			valid := mode == "valid" || mode == "same beneficiary"
			if e := verifyCandidateCreatorEpochs(context.Background(), f, m, c); (e == nil) != valid {
				t.Fatal(mode, e)
			}
			client, countReads := stateHTTPFixture(t, h, f)
			if e := verifyCandidateCreatorEpochs(context.Background(), client, m, c); (e == nil) != valid {
				t.Fatal("HTTP", mode, e)
			}
			if valid && countReads.Load() != 15 {
				t.Fatal("incomplete reads", countReads.Load())
			}
		})
	}
}
