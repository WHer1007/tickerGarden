package integration

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/httpapi"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/transactions"
)

func testTransactionHTTP(t *testing.T, ctx context.Context, pool *pgxpool.Pool, store *transactions.Store) {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT payload FROM tickergarden.chain_receipts WHERE chain_id=421614 AND block_hash=$1 AND transaction_hash=$2`, hash(503), hash(550)).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var receipt chainrpc.Receipt
	if json.Unmarshal(raw, &receipt) != nil {
		t.Fatal("invalid fixture receipt")
	}
	var changing atomic.Bool
	var latestCalls atomic.Int32
	rpcServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ID     int               `json:"id"`
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		var result any
		switch request.Method {
		case "eth_chainId":
			result = "0x66eee"
		case "eth_getBlockByNumber":
			var tag string
			if len(request.Params) < 1 || json.Unmarshal(request.Params[0], &tag) != nil {
				http.Error(w, "invalid tag", 400)
				return
			}
			number, block, parent := "0x2", hash(503), hash(501)
			switch tag {
			case "0x0":
				number, block, parent = "0x0", hash(500), hash(0)
			case "finalized", "0x1":
				number, block, parent = "0x1", hash(501), hash(500)
			case "latest":
				if latestCalls.Add(1) > 1 && changing.Load() {
					block = hash(504)
				}
			case "0x2":
			default:
				http.Error(w, "unexpected block", 400)
				return
			}
			result = chainrpc.Header{Number: number, Hash: block, ParentHash: parent, Timestamp: "0x64"}
		case "eth_getTransactionByHash":
			result = map[string]any{"hash": receipt.TransactionHash, "from": "0x0000000000000000000000000000000000000001", "to": "0x0000000000000000000000000000000000000002", "nonce": "0x0", "blockHash": receipt.BlockHash, "blockNumber": receipt.BlockNumber, "transactionIndex": receipt.TransactionIndex}
		case "eth_getTransactionReceipt":
			result = receipt
		default:
			http.Error(w, "unexpected method", 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result})
	}))
	defer rpcServer.Close()
	rpc, err := chainrpc.New(rpcServer.URL)
	if err != nil {
		t.Fatal(err)
	}
	service := &transactions.Service{Journal: store, RPC: rpc, ChainID: 421614, GenesisHash: hash(500)}
	handler := httpapi.New(httpapi.Options{ChainID: 421614, Transactions: service})
	server := httptest.NewServer(handler)
	defer server.Close()
	check := func(expected int) {
		t.Helper()
		latestCalls.Store(0)
		response, err := http.Get(server.URL + "/v1/transactions/" + hash(550))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != expected {
			t.Fatal(response.StatusCode, string(body), err)
		}
		schema := "TransactionError"
		if expected == 200 {
			schema = "TransactionStatusResponse"
		}
		if err := readmodel.ValidateResponse(schema, body); err != nil {
			t.Fatal(err)
		}
		if expected == 200 {
			var got transactions.CombinedStatus
			json.Unmarshal(body, &got)
			if got.State != "confirmed" || got.Receipt == nil || got.Receipt.Execution != "reverted" || len(got.OrphanedReceipts) != 1 {
				t.Fatal(got)
			}
		}
	}
	check(200)
	testFrontendAnalyticsHTTP(t, handler, "transaction", hash(550))
	changing.Store(true)
	check(503)
	latestCalls.Store(0)
	testFrontendAnalyticsHTTP(t, handler, "transaction-unavailable", hash(550))
}
