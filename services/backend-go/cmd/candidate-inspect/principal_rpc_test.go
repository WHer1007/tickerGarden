package main

import (
	"context"
	"errors"
	"math/big"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

type principalObserver struct {
	deployment.BindingObserver
	values map[string]string
	hash   string
}

func (f principalObserver) CallAt(_ context.Context, _, data, hash string) ([]byte, error) {
	value, ok := f.values[data[:10]]
	if !ok || hash != f.hash {
		return nil, errors.New("unavailable")
	}
	n, _ := new(big.Int).SetString(value, 10)
	return n.FillBytes(make([]byte, 32)), nil
}
func TestCandidatePrincipalRPC(t *testing.T) {
	for _, mode := range []string{"valid", "extra balance", "underfunded", "account changed", "free mismatch", "total mismatch", "omitted account", "RPC failure"} {
		t.Run(mode, func(t *testing.T) {
			hash := "0x" + strings.Repeat("1", 64)
			address := "0x" + strings.Repeat("2", 40)
			user := "0x" + strings.Repeat("3", 40)
			amount := "900719925474099312345"
			raw := map[string]string{"deposited(bytes32,address)": amount, "allocated(bytes32,address)": "0", "freeBalanceOf(bytes32,address)": amount, "totalDeposited(bytes32)": amount, "totalAllocated(bytes32)": "0", "balanceOf(address)": amount}
			c := readmodel.CandidateSet{ChainID: 46630, BlockHash: hash, Accounts: []readmodel.AccountCandidate{{AssetUID: hash, Vault: address, User: user, Deposited: amount, Allocated: "0", Free: amount}}}
			assets := map[string]deployment.AssetDiscovery{hash: {ChainID: 46630, BlockHash: hash, AssetUID: hash, Vault: deployment.Contract{Address: address}, State: map[string]any{"stockToken": user}}}
			switch mode {
			case "extra balance":
				raw["balanceOf(address)"] = "900719925474099312346"
			case "underfunded":
				raw["balanceOf(address)"] = "1"
			case "account changed":
				raw["deposited(bytes32,address)"] = "1"
			case "free mismatch":
				raw["freeBalanceOf(bytes32,address)"] = "0"
			case "total mismatch":
				raw["totalAllocated(bytes32)"] = "1"
			case "omitted account":
				c.Accounts = nil
			case "RPC failure":
				delete(raw, "totalDeposited(bytes32)")
			}
			values := map[string]string{}
			for signature, value := range raw {
				values[deployment.Hash([]byte(signature))[:10]] = value
			}
			if e := verifyCandidatePrincipalRPC(context.Background(), principalObserver{values: values, hash: hash}, c, assets); (e == nil) != (mode == "valid" || mode == "extra balance") {
				t.Fatal(mode, e)
			}
		})
	}
}
