package chainrpc

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Opt-in isolated process only; this test never accepts an external RPC URL.
func TestIsolatedAnvilSubmission(t *testing.T) {
	binary := os.Getenv("ANVIL")
	if binary == "" {
		t.Skip("ANVIL executable required")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	command := exec.Command(binary, "--host", "127.0.0.1", "--port", strconv.Itoa(port), "--chain-id", "46630", "--silent")
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() })
	c, err := New("http://127.0.0.1:" + strconv.Itoa(port))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for {
		if id, e := c.ChainID(ctx); e == nil {
			if id != 46630 {
				t.Fatal("wrong isolated chain")
			}
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("isolated Anvil startup timed out")
		case <-time.After(20 * time.Millisecond):
		}
	}
	var accounts []string
	if err = c.call(ctx, "eth_accounts", []any{}, &accounts); err != nil || len(accounts) < 2 {
		t.Fatalf("accounts: %v", err)
	}
	var signed json.RawMessage
	call := map[string]string{"from": accounts[0], "to": accounts[1], "value": "0x0", "gas": "0x5208", "nonce": "0x0", "maxFeePerGas": "0x174876e800", "maxPriorityFeePerGas": "0x3b9aca00", "type": "0x2", "chainId": "0xb626"}
	if err = c.call(ctx, "eth_signTransaction", []any{call}, &signed); err != nil {
		t.Fatal(err)
	}
	var encoded string
	if json.Unmarshal(signed, &encoded) != nil {
		var object struct{ Raw string }
		if json.Unmarshal(signed, &object) != nil {
			t.Fatal("invalid signed response")
		}
		encoded = object.Raw
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(encoded, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	hash, err := c.SendRawTransaction(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	var receipt *Receipt
	for receipt == nil {
		receipt, err = c.TransactionReceipt(ctx, hash)
		if err != nil {
			t.Fatal(err)
		}
		if receipt == nil {
			select {
			case <-ctx.Done():
				t.Fatal("receipt timeout")
			case <-time.After(20 * time.Millisecond):
			}
		}
	}
	trace, traceErr := c.TransactionCallTrace(ctx, hash)
	if traceErr != nil || !strings.EqualFold(trace.From, accounts[0]) || !strings.EqualFold(trace.To, accounts[1]) || trace.Input != "0x" || trace.Value != "0x0" || trace.Error != "" {
		t.Fatalf("local trace: %#v %v", trace, traceErr)
	}
	if receipt.Status != "0x1" {
		t.Fatalf("receipt: %#v %v", receipt, err)
	}
	header, err := c.Header(ctx, receipt.BlockNumber)
	if err != nil || header.Hash != receipt.BlockHash {
		t.Fatalf("canonical header: %#v %v", header, err)
	}
	nonce, err := c.PendingNonce(ctx, accounts[0])
	if err != nil || nonce != 1 {
		t.Fatalf("nonce: %d %v", nonce, err)
	}

	// Runtime stores calldata word in slot 0. Creation and writes stay inside
	// this disposable Anvil process; no external RPC can be supplied.
	var deployed string
	if err = c.call(ctx, "eth_sendTransaction", []any{map[string]string{"from": accounts[0], "data": "0x6006600c60003960066000f3600035600055", "gas": "0x30000"}}, &deployed); err != nil {
		t.Fatal(err)
	}

	var deploymentReceipt *struct{ ContractAddress string }
	for deploymentReceipt == nil {
		if err = c.callResult(ctx, "eth_getTransactionReceipt", []any{deployed}, &deploymentReceipt, true); err != nil {
			t.Fatal("deployment", err)
		}
		if deploymentReceipt == nil {
			select {
			case <-ctx.Done():
				t.Fatal("deployment receipt timeout")
			case <-time.After(20 * time.Millisecond):
			}
		}
	}
	if deploymentReceipt.ContractAddress == "" {
		t.Fatal("missing contract address")
	}
	for _, value := range []string{stateOne, stateZero} {
		var txhash string
		if err = c.call(ctx, "eth_sendTransaction", []any{map[string]string{"from": accounts[0], "to": deploymentReceipt.ContractAddress, "data": value, "value": "0x7", "gas": "0x30000"}}, &txhash); err != nil {
			t.Fatal(err)
		}
		for {
			rr, e := c.TransactionReceipt(ctx, txhash)
			if e != nil {
				t.Fatal(e)
			}
			if rr != nil {
				if rr.Status != "0x1" {
					t.Fatal("storage write reverted")
				}
				break
			}
			select {
			case <-ctx.Done():
				t.Fatal("storage receipt timeout")
			case <-time.After(20 * time.Millisecond):
			}
		}
		traced, e := c.TransactionState(ctx, txhash)
		if e != nil {
			t.Fatal("state trace", e)
		}
		balanceBefore, balanceAfter, balanceErr := traced.ContractBalanceTransition(strings.ToLower(deploymentReceipt.ContractAddress))
		wantBefore, wantAfter := "0", "7"
		if value == stateZero {
			wantBefore, wantAfter = "7", "14"
		}
		if balanceErr != nil || balanceBefore != wantBefore || balanceAfter != wantAfter {
			t.Fatal("native balance", balanceBefore, balanceAfter, balanceErr)
		}
		before, after, e := traced.StorageTransition(strings.ToLower(deploymentReceipt.ContractAddress), stateZero)
		expectedBefore := stateZero
		if value == stateZero {
			expectedBefore = stateOne
		}
		if e != nil || before != expectedBefore || after != value {
			t.Fatal("actual SSTORE transition", before, after, e)
		}
	}
	missing, err := c.TransactionReceipt(ctx, "0x"+strings.Repeat("9", 64))
	if err != nil || missing != nil {
		t.Fatalf("absent receipt: %#v %v", missing, err)
	}
}
