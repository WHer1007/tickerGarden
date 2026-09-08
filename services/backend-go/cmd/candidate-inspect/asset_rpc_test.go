package main

import (
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func TestCandidateAssetsMatchRPC(t *testing.T) {
	for _, mode := range []string{"valid", "missing", "extra", "duplicate", "chain", "block", "vault", "minimum", "status", "fingerprint"} {
		t.Run(mode, func(t *testing.T) {
			hash := "0x" + strings.Repeat("1", 64)
			token := "0x" + strings.Repeat("2", 40)
			vault := "0x" + strings.Repeat("3", 40)
			state := map[string]any{"stockToken": token, "userStockVault": vault, "tokenDecimals": "18", "minimumAllocation": "414", "status": "1"}
			fp := map[string]any{"tokenRuntimeCodeHash": hash, "beacon": token, "beaconRuntimeCodeHash": hash, "implementation": token, "implementationRuntimeCodeHash": hash}
			a := deployment.AssetDiscovery{ChainID: 46630, BlockHash: hash, AssetUID: hash, State: state, Fingerprint: fp, Vault: deployment.Contract{Module: "UserStockVault", Address: vault, RuntimeCodeHash: hash}}
			values := map[string]any{"stockToken": token, "userStockVault": vault, "tokenDecimals": uint64(18), "minimumAllocation": "414", "vaultRuntimeCodeHash": hash}
			for k, v := range fp {
				values[k] = v
			}
			config := readmodel.ConfigReadModel{Kind: "asset", ID: hash, Status: 1, Values: values, Source: readmodel.SourceBlock{ChainID: 46630, BlockNumber: "10", BlockHash: hash, TransactionHash: hash}}
			c := readmodel.CandidateSet{ChainID: 46630, BlockNumber: "10", BlockHash: hash, Configs: []readmodel.ConfigReadModel{config}}
			switch mode {
			case "chain":
				a.ChainID = 4663
			case "block":
				a.BlockHash = "0x" + strings.Repeat("9", 64)
			case "vault":
				a.Vault.Address = token
			case "minimum":
				state["minimumAllocation"] = "415"
			case "status":
				state["status"] = "2"
			case "fingerprint":
				fp["implementation"] = vault
			case "duplicate":
				c.Configs = append(c.Configs, config)
			}
			assets := map[string]deployment.AssetDiscovery{hash: a}
			if mode == "missing" {
				delete(assets, hash)
			}
			if mode == "extra" {
				assets["other"] = a
			}
			if e := matchCandidateAssets(c, assets); (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
		})
	}
}
