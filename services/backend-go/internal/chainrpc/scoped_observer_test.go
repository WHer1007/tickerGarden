package chainrpc

import (
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
)

func scopedHeader(t *testing.T, bloom types.Bloom) (Header, []byte) {
	t.Helper()
	h := types.Header{ParentHash: crypto.Keccak256Hash([]byte("parent")), Number: big.NewInt(17), Difficulty: big.NewInt(1), GasLimit: 30_000_000, GasUsed: 21_000, Time: 123, Bloom: bloom, UncleHash: types.EmptyUncleHash, TxHash: types.EmptyTxsHash, ReceiptHash: types.EmptyReceiptsHash}
	hash := h.Hash().Hex()
	raw, _ := json.Marshal(&h)
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	fields["hash"], _ = json.Marshal(hash)
	fields["number"], _ = json.Marshal("0x11")
	raw, _ = json.Marshal(fields)
	return Header{Hash: hash, Number: "0x11", Timestamp: "0x7b", ParentHash: h.ParentHash.Hex()}, raw
}

func scopedRPCServer(t *testing.T, block []byte, receipts string, receiptCalls *atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode RPC request: %v", err)
			return
		}
		if req.Method == "eth_getBlockReceipts" {
			receiptCalls.Add(1)
		}
		result := string(block)
		if req.Method == "eth_getBlockReceipts" {
			result = receipts
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + result + `}`))
	}))
}

func TestScopedObserverNegativeBloomReturnsExclusionWithoutReceipts(t *testing.T) {
	h, block := scopedHeader(t, types.Bloom{})
	var receiptCalls atomic.Int32
	srv := scopedRPCServer(t, block, `null`, &receiptCalls)
	defer srv.Close()
	c, err := New(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	observer := ScopedObserver{Client: c, Emitters: func(context.Context, Header) ([]string, error) {
		return []string{"0x1111111111111111111111111111111111111111"}, nil
	}}
	obs, err := observer.Observe(context.Background(), h)
	if err != nil || obs.Exclusion == nil || obs.RootProof != nil || len(obs.Receipts) != 0 {
		t.Fatalf("negative bloom observation = %+v, err=%v", obs, err)
	}
	if receiptCalls.Load() != 0 {
		t.Fatal("negative bloom requested eth_getBlockReceipts")
	}
}

func TestScopedObserverPositiveBloomFailsClosedForMissingReceipts(t *testing.T) {
	emitter := common.HexToAddress("0x1111111111111111111111111111111111111111")
	var bloom types.Bloom
	bloom.Add(emitter.Bytes())
	h, block := scopedHeader(t, bloom)
	var receiptCalls atomic.Int32
	srv := scopedRPCServer(t, block, `null`, &receiptCalls)
	defer srv.Close()
	c, err := New(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	observer := ScopedObserver{Client: c, Emitters: func(context.Context, Header) ([]string, error) { return []string{emitter.Hex()}, nil }}
	obs, err := observer.Observe(context.Background(), h)
	if err == nil || obs.Exclusion != nil || obs.RootProof != nil || len(obs.Receipts) != 0 {
		t.Fatalf("positive bloom accepted incomplete receipts: %+v, err=%v", obs, err)
	}
	if receiptCalls.Load() != 1 {
		t.Fatalf("eth_getBlockReceipts calls = %d, want 1", receiptCalls.Load())
	}
}

func TestScopedObserverRequiresEmitters(t *testing.T) {
	observer := ScopedObserver{}
	if _, err := observer.Observe(context.Background(), Header{}); err == nil {
		t.Fatal("missing Emitters accepted")
	}
}
