package chainrpc

import (
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/trie"
)

func TestVerifyReceiptRoot(t *testing.T) {
	for _, mode := range []string{"legacy", "typed", "nitro", "empty", "wrong root", "wrong header hash", "wrong branch", "wrong bloom", "wrong gas", "reorg", "unsupported", "missing type", "changed observation"} {
		t.Run(mode, func(t *testing.T) {
			typ := uint8(0)
			if mode == "typed" || mode == "missing type" {
				typ = 2
			}
			if mode == "nitro" {
				typ = 0x64
			}
			if mode == "unsupported" {
				typ = 0x78
			}
			txHash := common.HexToHash("0x1234")
			receipt := types.Receipt{Type: typ, Status: 1, CumulativeGasUsed: 21000, GasUsed: 21000, TxHash: txHash, BlockNumber: big.NewInt(1), Logs: []*types.Log{}}
			value, err := rlp.EncodeToBytes([]any{receipt.Status, receipt.CumulativeGasUsed, receipt.Bloom, receipt.Logs})
			if typ != 0 {
				value = append([]byte{typ}, value...)
			}
			if err != nil {
				t.Fatal(err)
			}
			receipts := encodedReceiptList{value}
			transactions := []string{txHash.Hex()}
			gas := uint64(21000)
			if mode == "empty" {
				receipts = encodedReceiptList{}
				transactions = []string{}
				gas = 0
			}
			root := types.DeriveSha(receipts, trie.NewStackTrie(nil))
			if mode == "wrong root" {
				root = common.HexToHash("0x4321")
			}
			if mode == "wrong gas" {
				gas++
			}
			header := types.Header{Number: big.NewInt(1), Difficulty: big.NewInt(0), GasLimit: 30000000, GasUsed: gas, Time: 100, UncleHash: types.EmptyUncleHash, TxHash: types.EmptyTxsHash, ReceiptHash: root}
			hash := header.Hash().Hex()
			receipt.BlockHash = header.Hash()
			if mode == "wrong branch" {
				receipt.BlockHash = common.HexToHash("0x9999")
			}
			if mode == "wrong bloom" {
				receipt.Bloom[0] = 1
			}
			headerData, _ := json.Marshal(&header)
			var block map[string]any
			json.Unmarshal(headerData, &block)
			block["hash"] = hash
			block["transactions"] = transactions
			if mode == "wrong header hash" {
				block["gasLimit"] = "0x1"
			}
			receiptData, _ := json.Marshal(&receipt)
			var receiptMap map[string]any
			json.Unmarshal(receiptData, &receiptMap)
			if mode == "missing type" {
				delete(receiptMap, "type")
			}
			receiptReads := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					ID     json.RawMessage `json:"id"`
					Method string          `json:"method"`
				}
				if json.NewDecoder(r.Body).Decode(&request) != nil {
					t.Error("request decode")
					return
				}
				var result any
				switch request.Method {
				case "eth_getBlockByHash":
					result = block
				case "eth_getTransactionReceipt":
					result = receiptMap
					receiptReads++
					if mode == "changed observation" && receiptReads == 1 {
						copyMap := make(map[string]any, len(receiptMap))
						for k, v := range receiptMap {
							copyMap[k] = v
						}
						copyMap["status"] = "0x0"
						result = copyMap
					}
				case "eth_getLogs":
					result = []Log{}
				case "eth_getBlockByNumber":
					result = block
					if mode == "reorg" {
						result = map[string]any{"number": "0x1", "hash": common.HexToHash("0x9999").Hex()}
					}
				default:
					t.Error(request.Method)
				}
				json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result})
			}))
			defer server.Close()
			rpc, err := New(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "changed observation" {
				_, err := (RootVerifiedClient{Client: rpc}).Observe(context.Background(), Header{Hash: hash, Number: "0x1", ParentHash: header.ParentHash.Hex(), Timestamp: "0x64"})
				if err == nil || err.Error() != "observed receipts differ from root-verified receipt set" {
					t.Fatal(err)
				}
				return
			}
			got, err := rpc.VerifyReceiptRoot(context.Background(), hash)
			valid := mode == "legacy" || mode == "typed" || mode == "nitro" || mode == "empty"
			if (err == nil) != valid {
				t.Fatal(mode, got, err)
			}
			if valid && (got.BlockHash != hash || got.ReceiptCount != len(transactions) || got.ReceiptRoot != root.Hex()) {
				t.Fatal(got)
			}
			if valid {
				offline, offlineErr := VerifyReceiptRootBundle(got.Bundle.Header, got.Bundle.Receipts, hash)
				if offlineErr != nil || offline.BlockHash != got.BlockHash || offline.ReceiptRoot != got.ReceiptRoot || offline.ReceiptCount != got.ReceiptCount || offline.ReceiptSetHash != got.ReceiptSetHash {
					t.Fatal("offline receipt bundle verification failed", offlineErr)
				}
				observation, err := (RootVerifiedClient{Client: rpc}).Observe(context.Background(), Header{Hash: hash, Number: "0x1", ParentHash: header.ParentHash.Hex(), Timestamp: "0x64"})
				if err != nil {
					t.Fatal(err)
				}
				if observation.RootProof == nil || !reflect.DeepEqual(*observation.RootProof, got) {
					t.Fatal("missing or mismatched attached root evidence", observation.RootProof, got)
				}
			}
		})
	}
}
