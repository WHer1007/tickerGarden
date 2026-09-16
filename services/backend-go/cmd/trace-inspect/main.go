// trace-inspect probes one transaction trace without signing or replaying it.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"tickergarden/backend/internal/chainrpc"
)

func run(ctx context.Context, args []string, out, errOut io.Writer) int {
	fail := func(s string) int { fmt.Fprintln(errOut, s); return 1 }
	if len(args) == 1 && args[0] == "--describe" {
		if json.NewEncoder(out).Encode(map[string]any{"service": "trace-inspect", "readOnly": true, "historyVerified": false, "publicationEligible": false}) != nil {
			return 1
		}
		return 0
	}
	if len(args) != 3 || args[0] != "--once" {
		return fail("usage: trace-inspect --describe | --once CHAIN_ID TRANSACTION_HASH")
	}
	id, e := strconv.ParseUint(args[1], 10, 63)
	if e != nil || id == 0 {
		return fail("invalid chain ID")
	}
	endpoint := os.Getenv("TG_HOLDER_RPC_URL")
	if endpoint == "" {
		endpoint = os.Getenv("TG_RPC_URL")
	}
	rpc, e := chainrpc.New(endpoint)
	if e != nil {
		return fail("RPC unavailable")
	}
	actual, e := rpc.ChainID(ctx)
	if e != nil || actual != id {
		return fail("RPC chain identity unavailable or mismatch")
	}
	tr, e := rpc.TransactionCallTrace(ctx, args[2])
	report := map[string]any{"chainId": id, "historyVerified": false, "publicationEligible": false, "traceAvailable": e == nil}
	code := 0
	if e != nil {
		var diagnostic *chainrpc.TraceError
		if errors.As(e, &diagnostic) {
			report["diagnostic"] = diagnostic
		}
		code = 2
	} else {
		report["rootType"] = tr.Type
	}
	if json.NewEncoder(out).Encode(report) != nil {
		return fail("cannot write diagnostic")
	}
	return code
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Stdout, os.Stderr))
}
