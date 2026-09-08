package main

import (
	"errors"
	"math/big"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func TestCandidateAllocationRPC(t *testing.T) {
	for _, mode := range []string{"valid", "allocation changed", "market total changed", "missing position", "missing account", "duplicate position", "wrong market asset", "RPC failure"} {
		t.Run(mode, func(t *testing.T) {
			id := "0x" + strings.Repeat("1", 64)
			market := "0x" + strings.Repeat("2", 64)
			user := "0x" + strings.Repeat("3", 40)
			vault := "0x" + strings.Repeat("4", 40)
			c := readmodel.CandidateSet{Markets: []readmodel.MarketReadModel{{MarketID: market, AssetUID: id}}, Accounts: []readmodel.AccountCandidate{{AssetUID: id, User: user, Allocated: "10"}}, Positions: []readmodel.UserPositionReadModel{{AssetUID: id, MarketID: market, User: user, Allocated: "10"}}}
			assets := map[string]deployment.AssetDiscovery{id: {Vault: deployment.Contract{Address: vault}}}
			switch mode {
			case "missing position":
				c.Positions = nil
			case "missing account":
				c.Accounts = nil
			case "duplicate position":
				c.Positions = append(c.Positions, c.Positions[0])
			case "wrong market asset":
				c.Markets[0].AssetUID = market
			}
			read := func(address, signature, args string) (*big.Int, error) {
				if mode == "RPC failure" {
					return nil, errors.New("offline")
				}
				if address != vault {
					t.Fatal("wrong Vault")
				}
				switch signature {
				case "allocation(bytes32,address,bytes32)":
					if args != id[2:]+strings.Repeat("0", 24)+user[2:]+market[2:] {
						t.Fatal("allocation arguments")
					}
					if mode == "allocation changed" {
						return big.NewInt(9), nil
					}
				case "marketAllocated(bytes32,bytes32)":
					if args != id[2:]+market[2:] {
						t.Fatal("market arguments")
					}
					if mode == "market total changed" {
						return big.NewInt(11), nil
					}
				default:
					t.Fatal("unexpected getter")
				}
				return big.NewInt(10), nil
			}
			if e := verifyCandidateAllocationsRPC(c, assets, read); (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
		})
	}
}
