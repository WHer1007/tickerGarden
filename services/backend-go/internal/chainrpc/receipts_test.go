package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const receiptBlockHash = "0x" + "1111111111111111111111111111111111111111111111111111111111111111"
const receiptParentHash = "0x" + "2222222222222222222222222222222222222222222222222222222222222222"
const receiptTx0 = "0x" + "3333333333333333333333333333333333333333333333333333333333333333"
const receiptTx1 = "0x" + "4444444444444444444444444444444444444444444444444444444444444444"

func receiptLog() map[string]any {
	return map[string]any{"address": "0x0000000000000000000000000000000000000001", "topics": []string{testHash}, "data": "0x", "blockNumber": "0x1", "blockHash": receiptBlockHash, "transactionHash": receiptTx0, "transactionIndex": "0x0", "logIndex": "0x0", "removed": false}
}

func receiptFixture() (map[string]any, map[string]map[string]any, []any) {
	block := map[string]any{"number": "0x1", "hash": receiptBlockHash, "parentHash": receiptParentHash, "timestamp": "0x64", "transactions": []string{receiptTx0, receiptTx1}}
	rs := map[string]map[string]any{
		receiptTx0: {"transactionHash": receiptTx0, "transactionIndex": "0x0", "blockHash": receiptBlockHash, "blockNumber": "0x1", "status": "0x1", "logs": []any{receiptLog()}},
		receiptTx1: {"transactionHash": receiptTx1, "transactionIndex": "0x1", "blockHash": receiptBlockHash, "blockNumber": "0x1", "status": "0x1", "logs": []any{}},
	}
	return block, rs, []any{receiptLog()}
}

func receiptServer(t *testing.T, block any, receipts map[string]map[string]any, logs any) (*httptest.Server, *Client) {
	t.Helper()
	s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
		var q struct {
			Method string `json:"method"`
			Params []any  `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&q); err != nil {
			t.Error(err)
			return
		}
		switch q.Method {
		case "eth_getBlockByHash":
			rpcReply(t, w, block)
		case "eth_getTransactionReceipt":
			h := q.Params[0].(string)
			rpcReply(t, w, receipts[h])
		case "eth_getLogs":
			rpcReply(t, w, logs)
		default:
			t.Errorf("unexpected RPC method %s", q.Method)
		}
	})
	return s, c
}

func TestLogsReceiptsValidAndEmptyBlock(t *testing.T) {
	block, rs, logs := receiptFixture()
	rs[receiptTx1]["status"] = "0x0" // failed transactions remain valid empty receipts
	s, c := receiptServer(t, block, rs, logs)
	defer s.Close()
	got, err := c.Logs(context.Background(), Header{Number: "0x1", Hash: receiptBlockHash, ParentHash: receiptParentHash, Timestamp: "0x64"})
	if err != nil || len(got) != 1 {
		t.Fatalf("Logs = %#v, %v", got, err)
	}
	empty := map[string]any{"number": "0x1", "hash": receiptBlockHash, "parentHash": receiptParentHash, "timestamp": "0x64", "transactions": []string{}}
	s.Close()
	s, c = receiptServer(t, empty, map[string]map[string]any{}, []any{})
	defer s.Close()
	got, err = c.Logs(context.Background(), Header{Number: "0x1", Hash: receiptBlockHash, ParentHash: receiptParentHash, Timestamp: "0x64"})
	if err != nil || len(got) != 0 {
		t.Fatalf("empty Logs = %#v, %v", got, err)
	}
}

func TestLogsRejectsReceiptAndCrossCheckFailures(t *testing.T) {
	cases := []string{"missing receipt", "null receipt", "wrong index", "wrong hash", "wrong block", "duplicate tx", "failed with logs", "filter missing", "filter extra", "filter altered", "gap index", "wrong parent"}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			block, rs, logs := receiptFixture()
			switch name {
			case "missing receipt":
				delete(rs, receiptTx1)
			case "null receipt":
				rs[receiptTx1] = nil
			case "wrong index":
				rs[receiptTx1]["transactionIndex"] = "0x0"
			case "wrong hash":
				rs[receiptTx1]["transactionHash"] = testHash
			case "wrong block":
				rs[receiptTx1]["blockHash"] = testHash
			case "duplicate tx":
				block["transactions"] = []string{receiptTx0, receiptTx0}
			case "failed with logs":
				rs[receiptTx0]["status"] = "0x0"
			case "filter missing":
				logs = []any{}
			case "filter extra":
				logs = append(logs, map[string]any{"address": "0x0000000000000000000000000000000000000001", "topics": []string{}, "data": "0x", "blockNumber": "0x1", "blockHash": receiptBlockHash, "transactionHash": receiptTx1, "transactionIndex": "0x1", "logIndex": "0x1", "removed": false})
			case "filter altered":
				logs[0].(map[string]any)["data"] = "0x01"
			case "gap index":
				rs[receiptTx0]["logs"].([]any)[0].(map[string]any)["logIndex"] = "0x2"
			case "wrong parent":
				block["parentHash"] = testHash
			}
			s, c := receiptServer(t, block, rs, logs)
			defer s.Close()
			if _, err := c.Logs(context.Background(), Header{Number: "0x1", Hash: receiptBlockHash, ParentHash: receiptParentHash, Timestamp: "0x64"}); err == nil {
				t.Fatal("invalid receipts accepted")
			}
		})
	}
}

func TestLogsCancellationFails(t *testing.T) {
	block, rs, logs := receiptFixture()
	s, c := receiptServer(t, block, rs, logs)
	defer s.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.Logs(ctx, Header{Number: "0x1", Hash: receiptBlockHash, ParentHash: receiptParentHash, Timestamp: "0x64"}); err == nil {
		t.Fatal("cancelled Logs succeeded")
	}
}
