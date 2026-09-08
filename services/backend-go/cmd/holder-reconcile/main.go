// holder-reconcile is a read-only diagnostic. An operator-supplied replay is
// deliberately not promoted to authenticated history or publication approval.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/holderledger"
)

type input struct {
	Config       holderledger.ReconcileConfig `json:"config"`
	Registration holderledger.Registration    `json:"registration"`
	Actions      []holderledger.Action        `json:"actions"`
	Block        chainrpc.Header              `json:"block"`
}

func decode(r io.Reader) (input, string, error) {
	var in input
	b, e := io.ReadAll(io.LimitReader(r, (4<<20)+1))
	if e != nil || len(b) > 4<<20 {
		return in, "", fmt.Errorf("invalid input size")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF || len(in.Actions) > 4096 || len(in.Registration.Balances) > in.Config.MaxAccounts || in.Config.MaxAccounts < 1 || in.Config.MaxAccounts > 10000 || (len(in.Actions)+1)*in.Config.MaxAccounts > 1000000 {
		return in, "", fmt.Errorf("invalid replay input or budget")
	}
	sum := sha256.Sum256(b)
	return in, hex.EncodeToString(sum[:]), nil
}
func run(ctx context.Context, args []string, out, errOut io.Writer) int {
	fail := func(s string) int { fmt.Fprintln(errOut, s); return 1 }
	if len(args) == 1 && args[0] == "--describe" {
		if json.NewEncoder(out).Encode(map[string]any{"service": "holder-reconcile", "readOnly": true, "historyVerified": false, "publicationEligible": false}) != nil {
			return 1
		}
		return 0
	}
	if len(args) != 2 || args[0] != "--once" {
		return fail("usage: holder-reconcile --describe | --once REPLAY.json")
	}
	f, e := os.Open(args[1])
	if e != nil {
		return fail("replay file unavailable")
	}
	in, digest, e := decode(f)
	f.Close()
	if e != nil {
		return fail("invalid replay input or budget")
	}
	l, e := holderledger.New(in.Registration)
	if e != nil {
		return fail("invalid registration")
	}
	for _, a := range in.Actions {
		if ctx.Err() != nil {
			return fail("reconciliation cancelled")
		}
		if e = l.Apply(a); e != nil {
			return fail("invalid replay action")
		}
		if len(l.Accounts) > in.Config.MaxAccounts {
			return fail("account budget exceeded")
		}
	}
	url := os.Getenv("TG_HOLDER_RPC_URL")
	if url == "" {
		url = os.Getenv("TG_RPC_URL")
	}
	rpc, e := chainrpc.New(url)
	if e != nil {
		return fail("holder RPC unavailable")
	}
	result, e := l.Reconcile(ctx, rpc, in.Config, in.Block)
	if e != nil {
		return fail("holder reconciliation unavailable; no verification result")
	}
	if json.NewEncoder(out).Encode(struct {
		InputDigest     string                      `json:"inputDigest"`
		HistoryVerified bool                        `json:"historyVerified"`
		Result          holderledger.Reconciliation `json:"result"`
	}{InputDigest: digest, Result: result}) != nil {
		return fail("cannot write reconciliation result")
	}
	if !result.FieldsMatched {
		return 2
	}
	return 0
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Stdout, os.Stderr))
}
