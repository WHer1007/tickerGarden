package readmodel

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

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

// Use the seeded getter observations as the controlled remote state, never the
// report's expected values. Mutations keep RPC totals self-consistent while
// contradicting the independently replayed database ledger.
func testFeeRPCPipeline(t *testing.T, ctx context.Context, store ObservationStore, manifest deployment.Manifest, b deployment.ObservationBatch) {
	t.Helper()
	c, err := store.LoadCandidateSet(ctx)
	if err != nil {
		t.Fatal("database fee RPC candidate", err)
	}
	vault := ""
	for _, contract := range manifest.Contracts {
		if contract.Module == "ProtocolFeeVault" {
			vault = contract.Address
		}
	}
	calls := map[string]string{}
	put := func(to, sig, args, amount string) {
		n, ok := new(big.Int).SetString(amount, 10)
		if !ok {
			t.Fatal(amount)
		}
		calls[to+deployment.Hash([]byte(sig))[:10]+args] = fmt.Sprintf("0x%064x", n)
	}
	creatorKey, stakerKey := "", ""
	for _, o := range b.Observations {
		if o.Kind == "feeLiability" {
			id := o.Value["marketId"].(string)
			asset := o.Value["feeAsset"].(string)
			args := id[2:] + strings.Repeat("0", 24) + asset[2:]
			for bucket, field := range []string{"creator", "staker", "platform", "holder"} {
				put(vault, "liability(bytes32,address,uint8)", args+fmt.Sprintf("%064x", bucket), o.Value[field].(string))
			}
			put(vault, "forfeitureReserve(bytes32,address)", args, o.Value["forfeitureReserve"].(string))
			if asset == c.Markets[0].QuoteAsset {
				creatorKey = vault + deployment.Hash([]byte("liability(bytes32,address,uint8)"))[:10] + args + fmt.Sprintf("%064x", 0)
				stakerKey = vault + deployment.Hash([]byte("liability(bytes32,address,uint8)"))[:10] + args + fmt.Sprintf("%064x", 1)
			}
		}
		if o.Kind == "feeSolvency" {
			put(vault, "totalLiability(address)", strings.Repeat("0", 24)+o.Key[2:], o.Value["totalLiability"].(string))
			put(o.Key, "balanceOf(address)", strings.Repeat("0", 24)+vault[2:], o.Value["balance"].(string))
		}
	}
	var mode, requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var q struct {
			ID     json.RawMessage   `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		var call struct {
			To   string `json:"to"`
			Data string `json:"data"`
		}
		var block struct {
			Hash      string `json:"blockHash"`
			Canonical bool   `json:"requireCanonical"`
		}
		if json.NewDecoder(r.Body).Decode(&q) != nil || q.Method != "eth_call" || len(q.Params) != 2 || json.Unmarshal(q.Params[0], &call) != nil || json.Unmarshal(q.Params[1], &block) != nil || block.Hash != b.BlockHash || !block.Canonical {
			t.Error("fee RPC did not use exact canonical block")
			http.Error(w, "invalid request", 400)
			return
		}
		key := call.To + call.Data
		value, ok := calls[key]
		if !ok || mode.Load() == 2 {
			json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "error": map[string]any{"code": -32000, "message": "historical state unavailable"}})
			return
		}
		if mode.Load() == 1 && (key == creatorKey || key == stakerKey) {
			n, _ := new(big.Int).SetString(value[2:], 16)
			delta := int64(1)
			if key == stakerKey {
				delta = -1
			}
			n.Add(n, big.NewInt(delta))
			value = fmt.Sprintf("0x%064x", n)
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "result": value})
	}))
	defer server.Close()
	client, err := chainrpc.New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	check := func(valid bool) {
		t.Helper()
		before := requests.Load()
		if err := VerifyFeeLedgerRPC(ctx, client, manifest, c); (err == nil) != valid {
			t.Fatal("database to HTTP fee RPC", mode.Load(), err)
		}
		if valid && requests.Load()-before != 14 {
			t.Fatal("fee RPC inventory", requests.Load()-before)
		}
	}
	check(true)
	mode.Store(1)
	if err := VerifyFeeCoverageRPC(ctx, client, manifest, c); err != nil {
		t.Fatal("self-consistent getter control", err)
	}
	check(false)
	mode.Store(2)
	check(false)
	mode.Store(0)
	check(true)
	if c.PublicationEligible || c.FeeReconciliation.Report.PublicationEligible {
		t.Fatal("RPC check promoted publication")
	}
}
