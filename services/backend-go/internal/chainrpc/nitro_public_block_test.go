package chainrpc

import (
	"encoding/json"
	"net/http"
	"os"
	"testing"
)

const nitroFixtureHash = "0xd724c7c27a13f4173b0d2f03a1b4f90b2d3da5ba47e64180484d462c40b3e41a"

// Captured from finalized Arbitrum Sepolia block 306336967 on 2026-09-07.
// This proves exact encoding against a real observed block, not RPC consensus.
func TestNitroPublicBlockTransactionRoot(t *testing.T) {
	raw, e := os.ReadFile("testdata/arb-sepolia-306336967.json")
	if e != nil {
		t.Fatal(e)
	}
	got, e := VerifyTransactionBlock(raw, 421614, nitroFixtureHash)
	if e != nil || len(got.Transactions) != 13 {
		t.Fatalf("real block: %+v %v", got, e)
	}
	if got.Transactions[0].Type != 0x6a || got.Transactions[0].Authentication != "nitro-internal" || got.Transactions[0].From != arbOSAddress {
		t.Fatal("system identity")
	}
	for _, tx := range got.Transactions[1:] {
		if tx.Type != 2 || tx.Authentication != "signature" {
			t.Fatal("user signature identity")
		}
	}
	for _, field := range []string{"from", "to", "value", "gas", "nonce", "input", "hash", "chainId", "v", "gasPrice"} {
		t.Run(field, func(t *testing.T) {
			var b map[string]any
			json.Unmarshal(raw, &b)
			sys := b["transactions"].([]any)[0].(map[string]any)
			switch field {
			case "from", "to":
				sys[field] = "0x0000000000000000000000000000000000000001"
			case "hash":
				sys[field] = testHash
			case "input":
				sys[field] = "0x01"
			default:
				sys[field] = "0x1"
			}
			mutated, _ := json.Marshal(b)
			if _, e := VerifyTransactionBlock(mutated, 421614, nitroFixtureHash); e == nil {
				t.Fatal("accepted forged system metadata", field)
			}
		})
	}
}

func TestNitroPublicBlockReceiptRoot(t *testing.T) {
	raw, e := os.ReadFile("testdata/arb-sepolia-306336967.json")
	if e != nil {
		t.Fatal(e)
	}
	verified, e := VerifyTransactionBlock(raw, 421614, nitroFixtureHash)
	if e != nil {
		t.Fatal(e)
	}
	var block map[string]json.RawMessage
	if json.Unmarshal(raw, &block) != nil {
		t.Fatal("block")
	}
	hashes := []string{}
	for _, tx := range verified.Transactions {
		hashes = append(hashes, tx.Hash)
	}
	block["transactions"], _ = json.Marshal(hashes)
	raw, e = os.ReadFile("testdata/arb-sepolia-306336967-receipts.json")
	if e != nil {
		t.Fatal(e)
	}
	var receipts []json.RawMessage
	if json.Unmarshal(raw, &receipts) != nil {
		t.Fatal("receipts")
	}
	byHash := map[string]json.RawMessage{}
	for _, r := range receipts {
		var v Receipt
		if json.Unmarshal(r, &v) != nil {
			t.Fatal("receipt")
		}
		byHash[v.TransactionHash] = r
	}
	server, rpc := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string
			Params []json.RawMessage
		}
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			t.Error("request")
			return
		}
		switch req.Method {
		case "eth_getBlockByHash", "eth_getBlockByNumber":
			rpcReply(t, w, block)
		case "eth_getTransactionReceipt":
			var h string
			json.Unmarshal(req.Params[0], &h)
			v, ok := byHash[h]
			if !ok {
				t.Error("unknown receipt")
			}
			rpcReply(t, w, v)
		default:
			t.Error("unexpected method", req.Method)
		}
	})
	defer server.Close()
	proof, e := rpc.VerifyReceiptRoot(t.Context(), nitroFixtureHash)
	if e != nil || proof.ReceiptRoot != verified.ReceiptRoot || proof.ReceiptCount != 13 {
		t.Fatalf("real receipt-root mismatch %+v %v", proof, e)
	}
}
