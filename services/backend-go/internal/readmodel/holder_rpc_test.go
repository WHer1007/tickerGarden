package readmodel

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

func testHolderRPC(t *testing.T, c CandidateSet, vault string, historicalFunding ...bool) {
	t.Helper()
	h := c.HolderMarkets[0]
	calls := map[string]string{}
	count := 2
	if h.Mode == "continuous-24h" {
		count = 1
	}
	for epoch := 1; epoch <= count; epoch++ {
		for _, asset := range []string{h.QuoteAsset, h.MemeToken} {
			amount := 0
			quoteEpoch := 1
			if len(historicalFunding) > 0 && historicalFunding[0] {
				quoteEpoch = 2
			}
			if epoch == quoteEpoch && asset == h.QuoteAsset {
				amount = 5
			}
			if asset == h.MemeToken && (epoch == 2 || h.Mode == "continuous-24h") {
				amount = 7
			}
			data := deployment.Hash([]byte("holderLiability(bytes32,uint32,address)"))[:10] + h.MarketID[2:] + fmt.Sprintf("%064x", epoch) + strings.Repeat("0", 24) + asset[2:]
			calls[data] = fmt.Sprintf("0x%064x", amount)
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
		if json.NewDecoder(r.Body).Decode(&q) != nil || q.Method != "eth_call" || len(q.Params) != 2 || json.Unmarshal(q.Params[0], &call) != nil || json.Unmarshal(q.Params[1], &block) != nil || call.To != vault || block.Hash != c.BlockHash || !block.Canonical {
			t.Error("Holder call binding")
			http.Error(w, "invalid", 400)
			return
		}
		value, ok := calls[call.Data]
		if !ok || mode.Load() == 3 {
			json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "error": map[string]any{"code": -32000, "message": "historical state missing"}})
			return
		}
		if mode.Load() == 1 && strings.HasSuffix(call.Data, h.QuoteAsset[2:]) {
			if value == fmt.Sprintf("0x%064x", 5) {
				value = fmt.Sprintf("0x%064x", 4)
			} else {
				value = fmt.Sprintf("0x%064x", 1)
			}
		}
		if mode.Load() == 2 {
			value = "0x01"
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": q.ID, "result": value})
	}))
	defer server.Close()
	client, err := chainrpc.New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	manifest := deployment.Manifest{Contracts: []deployment.Contract{{Module: "ProtocolFeeVault", Address: vault}}}
	check := func(valid bool) {
		t.Helper()
		before := requests.Load()
		if err := VerifyHolderEpochRPC(context.Background(), client, manifest, c); (err == nil) != valid {
			t.Fatal("Holder RPC", mode.Load(), err)
		}
		if valid && requests.Load()-before != int32(count*2) {
			t.Fatal("Holder RPC coverage")
		}
	}
	check(true)
	for _, failure := range []int32{1, 2, 3} {
		mode.Store(failure)
		check(false)
	}
	mode.Store(0)
	check(true)
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, failure := range []string{"missing", "mismatch", "duplicate", "extra", "wrong amount", "wrong binding", "missing history", "missing epoch"} {
		var copy CandidateSet
		if json.Unmarshal(raw, &copy) != nil {
			t.Fatal("clone")
		}
		report := copy.FeeReconciliation.HolderEpochs
		switch failure {
		case "missing":
			copy.FeeReconciliation.HolderEpochs = nil
		case "mismatch":
			report.Status = "mismatch"
		case "duplicate":
			report.Probes[1] = report.Probes[0]
		case "extra":
			report.Probes = append(report.Probes, report.Probes[0])
		case "wrong amount":
			report.Probes[0].Actual = "999"
		case "wrong binding":
			copy.FeeReconciliation.BlockHash = "0x" + strings.Repeat("f", 64)
		case "missing history":
			copy.ProtocolEventInventoryVerified = false
		case "missing epoch":
			report.Probes = report.Probes[:1]
		}
		before := requests.Load()
		if VerifyHolderEpochRPC(context.Background(), client, manifest, copy) == nil || requests.Load() != before {
			t.Fatal("bad evidence reached RPC", failure)
		}
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if VerifyHolderEpochRPC(cancelled, client, manifest, c) == nil {
		t.Fatal("cancelled RPC succeeded")
	}
}
