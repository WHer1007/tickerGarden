package chainrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

var stateAddress = "0x" + strings.Repeat("1", 40)
var stateSlot = "0x" + strings.Repeat("2", 64)
var stateZero = "0x" + strings.Repeat("0", 64)
var stateOne = "0x" + strings.Repeat("0", 63) + "1"
var stateTwo = "0x" + strings.Repeat("0", 63) + "2"

func strptr(s string) *string { return &s }
func stateFixture() TransactionStateTrace {
	return TransactionStateTrace{Prestate: TraceState{stateAddress: {Code: strptr("0x6000"), Storage: map[string]string{stateSlot: stateOne}}}, Diff: StateDiff{Pre: TraceState{stateAddress: {Storage: map[string]string{stateSlot: stateOne}}}, Post: TraceState{stateAddress: {Storage: map[string]string{stateSlot: stateTwo}}}}}
}
func TestStateStorageTransition(t *testing.T) {
	for _, mode := range []string{"changed", "unchanged", "zero-before", "zero-after", "missing", "mismatch", "deleted", "code-changed", "missing-zero-before", "pre-codehash"} {
		t.Run(mode, func(t *testing.T) {
			f := stateFixture()
			before, after := stateOne, stateTwo
			switch mode {
			case "unchanged":
				f.Diff.Pre = TraceState{}
				f.Diff.Post = TraceState{}
				after = before
			case "zero-before":
				f.Prestate[stateAddress].Storage[stateSlot] = stateZero
				delete(f.Diff.Pre[stateAddress].Storage, stateSlot)
				before = stateZero
			case "zero-after":
				delete(f.Diff.Post[stateAddress].Storage, stateSlot)
				after = stateZero
			case "missing":
				delete(f.Prestate[stateAddress].Storage, stateSlot)
			case "mismatch":
				f.Diff.Pre[stateAddress].Storage[stateSlot] = stateTwo
			case "deleted":
				delete(f.Diff.Post, stateAddress)
			case "code-changed":
				a := f.Diff.Post[stateAddress]
				a.Code = strptr("0x6001")
				f.Diff.Post[stateAddress] = a
			case "pre-codehash":
				a := f.Diff.Pre[stateAddress]
				a.CodeHash = strptr(stateOne)
				f.Diff.Pre[stateAddress] = a
			case "missing-zero-before":
				delete(f.Diff.Pre[stateAddress].Storage, stateSlot)
			}
			a, b, err := f.StorageTransition(stateAddress, stateSlot)
			if mode == "changed" || mode == "unchanged" || mode == "zero-before" || mode == "zero-after" {
				if err != nil || a != before || b != after {
					t.Fatal(a, b, err)
				}
			} else if err == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}
func TestTransactionStateProtocolAndBounds(t *testing.T) {
	for _, mode := range []string{"valid", "null", "null-account", "mismatch", "slot", "account", "oversize", "missing-post", "codehash"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			s, c := rpcServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				var req struct {
					Method string
					Params []json.RawMessage
				}
				if json.NewDecoder(r.Body).Decode(&req) != nil || req.Method != "debug_traceTransaction" || len(req.Params) != 2 {
					t.Error("request")
					return
				}
				var opts struct {
					Tracer       string
					TracerConfig struct {
						DiffMode       bool
						DisableCode    bool
						DisableStorage bool
					}
				}
				if json.Unmarshal(req.Params[1], &opts) != nil || opts.Tracer != "prestateTracer" || opts.TracerConfig.DiffMode != (calls == 2) || opts.TracerConfig.DisableCode || opts.TracerConfig.DisableStorage {
					t.Error("options")
				}
				f := stateFixture()
				if calls == 1 {
					switch mode {
					case "null":
						rpcReply(t, w, nil)
						return
					case "null-account":
						rpcReply(t, w, map[string]any{stateAddress: nil})
						return
					case "slot":
						f.Prestate[stateAddress].Storage["0x1"] = stateOne
					case "account":
						f.Prestate["bad"] = TraceAccount{}
					case "codehash":
						a := f.Prestate[stateAddress]
						a.CodeHash = strptr(stateOne)
						f.Prestate[stateAddress] = a
					case "oversize":
						a := f.Prestate[stateAddress]
						a.Code = strptr("0x" + strings.Repeat("00", 65537))
						f.Prestate[stateAddress] = a
					}
					rpcReply(t, w, f.Prestate)
					return
				}
				if mode == "mismatch" {
					f.Diff.Pre[stateAddress].Storage[stateSlot] = stateTwo
				}
				if mode == "missing-post" {
					f.Diff.Post = nil
				}
				rpcReply(t, w, f.Diff)
			})
			defer s.Close()
			_, err := c.TransactionState(context.Background(), "0x"+strings.Repeat("a", 64))
			if mode == "valid" {
				if err != nil || calls != 2 {
					t.Fatal(err, calls)
				}
			} else if err == nil {
				t.Fatal("accepted", mode)
			}
			if calls > 2 {
				t.Fatal("retry")
			}
		})
	}
}

func TestContractBalanceTransition(t *testing.T) {
	for _, mode := range []string{"increase", "zero-after", "unchanged", "missing", "mismatch", "deleted", "changed-code", "bad-balance"} {
		t.Run(mode, func(t *testing.T) {
			f := stateFixture()
			a := f.Prestate[stateAddress]
			a.Balance = strptr("0x7")
			f.Prestate[stateAddress] = a
			a = f.Diff.Pre[stateAddress]
			a.Balance = strptr("0x7")
			f.Diff.Pre[stateAddress] = a
			a = f.Diff.Post[stateAddress]
			a.Balance = strptr("0xa")
			f.Diff.Post[stateAddress] = a
			want := "10"
			switch mode {
			case "zero-after":
				a.Balance = strptr("0x0")
				f.Diff.Post[stateAddress] = a
				want = "0"
			case "unchanged":
				a.Balance = nil
				f.Diff.Post[stateAddress] = a
				want = "7"
			case "missing":
				a = f.Prestate[stateAddress]
				a.Balance = nil
				f.Prestate[stateAddress] = a
			case "mismatch":
				a = f.Diff.Pre[stateAddress]
				a.Balance = strptr("0x6")
				f.Diff.Pre[stateAddress] = a
			case "deleted":
				delete(f.Diff.Post, stateAddress)
			case "changed-code":
				a.Code = strptr("0x6001")
				f.Diff.Post[stateAddress] = a
			case "bad-balance":
				a.Balance = strptr("0x00")
				f.Diff.Post[stateAddress] = a
			}
			before, after, e := f.ContractBalanceTransition(stateAddress)
			if mode == "increase" || mode == "zero-after" || mode == "unchanged" {
				if e != nil || before != "7" || after != want {
					t.Fatal(before, after, e)
				}
			} else if e == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}
