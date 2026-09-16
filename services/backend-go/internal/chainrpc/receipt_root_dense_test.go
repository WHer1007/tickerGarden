package chainrpc

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/trie"
)

// Crosses the trie index 0x7f/0x80 boundary with mixed receipt encodings and logs.
// A controlled local server is a correctness/load fixture, not a production SLA.
func TestReceiptRootDenseObservation(t *testing.T) {
	const count = 256
	variants := []uint8{0, 1, 2, 3, 4, 0x64, 0x65, 0x66, 0x68, 0x69, 0x6a}
	for _, mode := range []string{"valid", "missing", "root mismatch", "deadline"} {
		t.Run(mode, func(t *testing.T) {
			receipts := make([]types.Receipt, count)
			encoded := make(encodedReceiptList, count)
			hashes := make([]string, count)
			allLogs := make([]*types.Log, 0, count)
			for i := range receipts {
				tx := common.HexToHash(fmt.Sprintf("0x%064x", i+1))
				hashes[i] = tx.Hex()
				log := &types.Log{Address: common.HexToAddress("0x1234"), Topics: []common.Hash{common.HexToHash("0x5678")}, Data: []byte{byte(i)}, BlockNumber: 1, TxHash: tx, TxIndex: uint(i), Index: uint(i)}
				r := types.Receipt{Type: variants[i%len(variants)], Status: 1, CumulativeGasUsed: uint64(i+1) * 21000, GasUsed: 21000, TxHash: tx, BlockNumber: big.NewInt(1), TransactionIndex: uint(i), Logs: []*types.Log{log}}
				r.Bloom = types.CreateBloom(&r)
				value, err := rlp.EncodeToBytes([]any{r.Status, r.CumulativeGasUsed, r.Bloom, r.Logs})
				if err != nil {
					t.Fatal(err)
				}
				if r.Type != 0 {
					value = append([]byte{r.Type}, value...)
				}
				receipts[i] = r
				encoded[i] = value
				allLogs = append(allLogs, log)
			}
			root := types.DeriveSha(encoded, trie.NewStackTrie(nil))
			header := types.Header{Number: big.NewInt(1), Difficulty: big.NewInt(0), GasLimit: 30000000, GasUsed: count * 21000, Time: 100, UncleHash: types.EmptyUncleHash, TxHash: types.EmptyTxsHash, ReceiptHash: root}
			// These logs share address/topics, so their aggregate bloom equals one receipt.
			header.Bloom = receipts[0].Bloom
			hash := header.Hash()
			lookup := map[string]int{}
			for i := range receipts {
				receipts[i].BlockHash = hash
				receipts[i].Logs[0].BlockHash = hash
				lookup[hashes[i]] = i
			}
			rawHeader, _ := json.Marshal(&header)
			var block map[string]any
			json.Unmarshal(rawHeader, &block)
			block["hash"] = hash.Hex()
			block["transactions"] = hashes
			var calls atomic.Int32
			release := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req struct {
					ID     json.RawMessage   `json:"id"`
					Method string            `json:"method"`
					Params []json.RawMessage `json:"params"`
				}
				if json.NewDecoder(r.Body).Decode(&req) != nil {
					t.Error("request decode")
					return
				}
				var result any
				switch req.Method {
				case "eth_getBlockByHash", "eth_getBlockByNumber":
					result = block
				case "eth_getLogs":
					result = allLogs
				case "eth_getTransactionReceipt":
					calls.Add(1)
					var tx string
					json.Unmarshal(req.Params[0], &tx)
					i, ok := lookup[tx]
					if !ok {
						t.Error("unexpected tx")
						return
					}
					if mode == "deadline" {
						select {
						case <-r.Context().Done():
						case <-release:
						}
						return
					}
					// Vary latency so completion order differs from transaction order.
					timer := time.NewTimer(time.Duration(7-i%8) * time.Millisecond)
					defer timer.Stop()
					select {
					case <-timer.C:
					case <-r.Context().Done():
						return
					}
					if mode == "missing" && i == 127 {
						result = nil
					} else {
						copyReceipt := receipts[i]
						if mode == "root mismatch" && i == 127 {
							copyReceipt.CumulativeGasUsed++
						}
						result = &copyReceipt
					}
				default:
					t.Error(req.Method)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
			}))
			defer server.Close()
			defer close(release)
			rpc, _ := New(server.URL)
			timeout := 10 * time.Second
			if mode == "deadline" {
				timeout = 100 * time.Millisecond
			}
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()
			start := time.Now()
			obs, err := (RootVerifiedClient{Client: rpc}).Observe(ctx, Header{Number: "0x1", Hash: hash.Hex(), ParentHash: header.ParentHash.Hex(), Timestamp: "0x64"})
			if mode == "root mismatch" && calls.Load() != 2*count {
				t.Fatal("did not reach full root verification", calls.Load())
			}
			if mode != "valid" {
				if err == nil || len(obs.Receipts) != 0 || obs.RootProof != nil {
					t.Fatal("partial or invalid observation escaped", err)
				}
				return
			}
			if err != nil || len(obs.Receipts) != count || len(obs.Logs) != count || obs.RootProof == nil || obs.RootProof.ReceiptRoot != root.Hex() || calls.Load() != 2*count {
				t.Fatal("dense observation", len(obs.Receipts), calls.Load(), err)
			}
			for i, receipt := range obs.Receipts {
				if receipt.TransactionHash != hashes[i] || receipt.Logs[0].LogIndex != fmt.Sprintf("0x%x", i) {
					t.Fatal("unordered observation", i)
				}
			}
			t.Logf("receipts=%d types=%d RPC_receipt_calls=%d elapsed=%s", count, len(variants), calls.Load(), time.Since(start))
		})
	}
}
