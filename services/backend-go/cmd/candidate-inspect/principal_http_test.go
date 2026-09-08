package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func TestPrincipalHTTPMultipleMarkets(t *testing.T) {
	for _, mode := range []string{"valid", "redistributed", "missing market position", "market total mismatch", "noncanonical ABI"} {
		t.Run(mode, func(t *testing.T) {
			hash := fmt.Sprintf("0x%064x", 1)
			id := fmt.Sprintf("0x%064x", 2)
			vault := fmt.Sprintf("0x%040x", 3)
			token := fmt.Sprintf("0x%040x", 4)
			users := []string{fmt.Sprintf("0x%040x", 5), fmt.Sprintf("0x%040x", 6)}
			markets := []string{fmt.Sprintf("0x%064x", 7), fmt.Sprintf("0x%064x", 8)}
			values := map[string]string{}
			put := func(address, signature, args, amount string) {
				n, _ := new(big.Int).SetString(amount, 10)
				values[address+":"+deployment.Hash([]byte(signature))[:10]+args] = fmt.Sprintf("0x%064x", n)
			}
			c := readmodel.CandidateSet{ChainID: 46630, BlockHash: hash}
			positions := [][]string{{"10", "20"}, {"40", "30"}}
			for i, user := range users {
				dep, alloc, free := "100", "30", "70"
				if i == 1 {
					dep, alloc, free = "200", "70", "130"
				}
				c.Accounts = append(c.Accounts, readmodel.AccountCandidate{User: user, AssetUID: id, Vault: vault, Deposited: dep, Allocated: alloc, Free: free})
				args := id[2:] + strings.Repeat("0", 24) + user[2:]
				put(vault, "deposited(bytes32,address)", args, dep)
				put(vault, "allocated(bytes32,address)", args, alloc)
				put(vault, "freeBalanceOf(bytes32,address)", args, free)
				for j, market := range markets {
					amount := positions[i][j]
					c.Positions = append(c.Positions, readmodel.UserPositionReadModel{User: user, AssetUID: id, MarketID: market, Allocated: amount})
					put(vault, "allocation(bytes32,address,bytes32)", args+market[2:], amount)
				}
			}
			for _, market := range markets {
				c.Markets = append(c.Markets, readmodel.MarketReadModel{MarketID: market, AssetUID: id})
				put(vault, "marketAllocated(bytes32,bytes32)", id[2:]+market[2:], "50")
			}
			put(vault, "totalDeposited(bytes32)", id[2:], "300")
			put(vault, "totalAllocated(bytes32)", id[2:], "100")
			put(token, "balanceOf(address)", strings.Repeat("0", 24)+vault[2:], "300")
			switch mode {
			case "redistributed":
				for i, amount := range []string{"20", "10", "30", "40"} {
					c.Positions[i].Allocated = amount
				}
			case "missing market position":
				c.Positions = c.Positions[:3]
			case "market total mismatch":
				put(vault, "marketAllocated(bytes32,bytes32)", id[2:]+markets[0][2:], "51")
			}
			calls := new(atomic.Int32)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var q struct {
					ID     json.RawMessage   `json:"id"`
					Method string            `json:"method"`
					Params []json.RawMessage `json:"params"`
				}
				var target struct {
					To   string `json:"to"`
					Data string `json:"data"`
				}
				var selector struct {
					Hash      string `json:"blockHash"`
					Canonical bool   `json:"requireCanonical"`
				}
				if json.NewDecoder(r.Body).Decode(&q) != nil || q.Method != "eth_call" || len(q.Params) != 2 || json.Unmarshal(q.Params[0], &target) != nil || json.Unmarshal(q.Params[1], &selector) != nil || selector.Hash != hash || !selector.Canonical {
					t.Error("invalid pinned RPC request")
					http.Error(w, "invalid", 400)
					return
				}
				value, ok := values[target.To+":"+target.Data]
				if !ok {
					t.Error("unexpected getter or arguments")
					http.Error(w, "invalid", 400)
					return
				}
				if mode == "noncanonical ABI" {
					value = "0x01"
				}
				json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "result": value})
			}))
			defer server.Close()
			rpc, e := chainrpc.New(server.URL)
			if e != nil {
				t.Fatal(e)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			assets := map[string]deployment.AssetDiscovery{id: {ChainID: 46630, BlockHash: hash, AssetUID: id, Vault: deployment.Contract{Address: vault}, State: map[string]any{"stockToken": token}}}
			e = verifyCandidatePrincipalRPC(ctx, rpc, c, assets)
			if (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
			if mode == "valid" && calls.Load() != 15 {
				t.Fatal("incomplete successful read inventory", calls.Load())
			}
		})
	}
}
