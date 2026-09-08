package main

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
	"time"
)

type gaugeObserver struct {
	deployment.BindingObserver
	hash  string
	calls map[string][]byte
}

func (f gaugeObserver) CodeAt(_ context.Context, _, h string) ([]byte, error) {
	if h != f.hash {
		return nil, errors.New("scope")
	}
	return []byte{1}, nil
}
func (f gaugeObserver) CallAt(_ context.Context, a, data, h string) ([]byte, error) {
	v, ok := f.calls[a+data]
	if !ok || h != f.hash {
		return nil, errors.New("scope")
	}
	return v, nil
}
func TestCandidateGaugeRPC(t *testing.T) {
	for _, mode := range []string{"pending", "processed", "wrong identity", "pending exit", "claim mismatch", "unlock mismatch", "processed zero refs", "active total", "pending total", "omitted user", "empty gauge", "duplicate user"} {
		t.Run(mode, func(t *testing.T) {
			h := "0x" + strings.Repeat("1", 64)
			g := "0x" + strings.Repeat("2", 40)
			a := "0x" + strings.Repeat("3", 40)
			f := "0x" + strings.Repeat("4", 40)
			u := "0x" + strings.Repeat("5", 40)
			calls := map[string][]byte{}
			put := func(address, sig, args string, words ...string) {
				raw := []byte{}
				for _, v := range words {
					v = strings.TrimPrefix(v, "0x")
					b, e := hex.DecodeString(strings.Repeat("0", 64-len(v)) + v)
					if e != nil {
						t.Fatal(e)
					}
					raw = append(raw, b...)
				}
				calls[address+deployment.Hash([]byte(sig))[:10]+args] = raw
			}
			id := h
			if mode == "wrong identity" {
				id = "0x" + strings.Repeat("6", 64)
			}
			put(g, "gaugeIdentity()", "", id, h, h, a, f, a, f)
			arg := strings.Repeat("0", 24) + u[2:]
			put(g, "positionOf(address)", arg, "46", "1e", "1", "64", "7", "8")
			exit := "0"
			if mode == "pending exit" {
				exit = "1"
			}
			put(a, "rageQuitSettlementPending(bytes32,address)", h[2:]+arg, exit, "0")
			processed, refs := "0", "1"
			if mode == "processed" || mode == "processed zero refs" {
				processed = "1"
			}
			if mode == "processed zero refs" {
				refs = "0"
			}
			put(g, "activationSnapshot(uint64)", strings.Repeat("0", 63)+"1", "0", "0", refs, processed)
			activeTotal, pendingTotal := "46", "1e"
			if mode == "processed" {
				activeTotal, pendingTotal = "64", "0"
			}
			if mode == "active total" {
				activeTotal = "47"
			}
			if mode == "pending total" {
				pendingTotal = "1f"
			}
			if mode == "empty gauge" {
				activeTotal, pendingTotal = "0", "0"
			}
			put(g, "storedTotalActiveStock()", "", activeTotal)
			put(g, "totalPendingStock()", "", pendingTotal)

			generation, unlock := "1", "100"
			p := readmodel.UserPositionReadModel{User: u, MarketID: h, AssetUID: h, Allocated: "100", Active: "70", Pending: "30", ActivationAt: &generation, UnlockAt: &unlock, Claimable: []readmodel.Claimable{{Kind: "quote", Asset: a, Amount: "7"}, {Kind: "meme", Asset: f, Amount: "8"}}}
			if mode == "processed" {
				p.Active = "100"
				p.Pending = "0"
				p.ActivationAt = nil
			}
			if mode == "claim mismatch" {
				p.Claimable[0].Amount = "9"
			}
			if mode == "unlock mismatch" {
				unlock = "101"
			}
			c := readmodel.CandidateSet{BlockHash: h, Markets: []readmodel.MarketReadModel{{MarketID: h, AssetUID: h, QuoteAssetConfigID: h, Gauge: g, QuoteAsset: a, MemeToken: f}}, Positions: []readmodel.UserPositionReadModel{p}}
			if mode == "omitted user" || mode == "empty gauge" {
				c.Positions = nil
			}
			if mode == "duplicate user" {
				c.Positions = append(c.Positions, c.Positions[0])
			}
			m := deployment.Manifest{Contracts: []deployment.Contract{{Module: "AllocationManager", Address: a}, {Module: "ProtocolFeeVault", Address: f}}}
			observer := gaugeObserver{hash: h, calls: calls}
			if e := verifyCandidateGauges(context.Background(), observer, m, c); (e == nil) != (mode == "pending" || mode == "processed" || mode == "empty gauge") {
				t.Fatal(mode, e)
			}
			client, count := stateHTTPFixture(t, h, observer)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			valid := mode == "pending" || mode == "processed" || mode == "empty gauge"
			if e := verifyCandidateGauges(ctx, client, m, c); (e == nil) != valid {
				t.Fatal("HTTP", mode, e)
			}
			expectedReads := int32(7)
			if mode == "empty gauge" {
				expectedReads = 4
			}
			if valid && count.Load() != expectedReads {
				t.Fatal("incomplete Gauge HTTP reads", count.Load())
			}

		})
	}
}
