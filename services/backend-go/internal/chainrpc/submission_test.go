package chainrpc

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ethereum/go-ethereum/crypto"
	"net/http"
	"testing"
)

func TestSendRawTransactionAcknowledgementAndUnknown(t *testing.T) {
	raw := []byte{2, 1, 2, 3}
	expected := crypto.Keccak256Hash(raw).Hex()
	for _, mode := range []string{"ack", "wrong hash", "null", "rpc error", "http error", "malformed"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				var req struct {
					Method string
					Params []string
				}
				if json.NewDecoder(r.Body).Decode(&req) != nil || req.Method != "eth_sendRawTransaction" || len(req.Params) != 1 || req.Params[0] != "0x02010203" {
					t.Error("wrong broadcast request")
				}
				switch mode {
				case "ack":
					rpcReply(t, w, expected)
				case "wrong hash":
					rpcReply(t, w, receiptTx0)
				case "null":
					rpcReply(t, w, nil)
				case "rpc error":
					_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"already known"}}`))
				case "http error":
					w.WriteHeader(503)
				case "malformed":
					_, _ = w.Write([]byte(`{`))
				}
			})
			defer s.Close()
			hash, err := c.SendRawTransaction(context.Background(), raw)
			if hash != expected || calls != 1 {
				t.Fatalf("hash=%s calls=%d", hash, calls)
			}
			if mode == "ack" {
				if err != nil {
					t.Fatal(err)
				}
			} else if !errors.Is(err, ErrSubmissionUnknown) {
				t.Fatalf("expected unknown, got %v", err)
			}
		})
	}
}

func TestSendRawTransactionBoundsAndCanceledContext(t *testing.T) {
	calls := 0
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) { calls++; rpcReply(t, w, receiptTx0) })
	defer s.Close()
	for _, raw := range [][]byte{nil, make([]byte, 16385)} {
		hash, err := c.SendRawTransaction(context.Background(), raw)
		if err == nil || hash != "" || errors.Is(err, ErrSubmissionUnknown) {
			t.Fatalf("invalid input: %s %v", hash, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	raw := []byte{2, 1}
	hash, err := c.SendRawTransaction(ctx, raw)
	if hash != crypto.Keccak256Hash(raw).Hex() || !errors.Is(err, ErrSubmissionUnknown) {
		t.Fatalf("canceled: %s %v", hash, err)
	}
	if calls != 0 {
		t.Fatalf("unexpected requests: %d", calls)
	}
}

func TestSendRawTransactionResponseLostAfterReceipt(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	received := make(chan struct{}, 1)
	release := make(chan struct{})
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		received <- struct{}{}
		cancel()
		<-release
	})
	defer func() { close(release); s.Close() }()
	raw := []byte{2, 3, 4}
	hash, err := c.SendRawTransaction(ctx, raw)
	if hash != crypto.Keccak256Hash(raw).Hex() || !errors.Is(err, ErrSubmissionUnknown) {
		t.Fatalf("lost response: %s %v", hash, err)
	}
	select {
	case <-received:
	default:
		t.Fatal("server never received request")
	}
}
