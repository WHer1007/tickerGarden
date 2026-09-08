// display-price-check performs a bounded, read-only upstream availability check.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"tickergarden/backend/internal/displayprice"
)

func run(ctx context.Context, args []string, out, diagnostics io.Writer) int {
	flags := flag.NewFlagSet("display-price-check", flag.ContinueOnError)
	flags.SetOutput(diagnostics)
	path := flags.String("config", "", "display reference target JSON file (required)")
	chain := flags.Uint64("chain-id", 0, "expected target chain ID (required)")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *path == "" || *chain == 0 || flags.NArg() != 0 {
		fmt.Fprintln(diagnostics, "--config and --chain-id are required; positional arguments are not accepted")
		return 2
	}
	service, err := displayprice.Load(*path, *chain)
	if err != nil {
		fmt.Fprintln(diagnostics, "invalid display price configuration")
		return 2
	}
	result := service.Check(ctx)
	if err := json.NewEncoder(out).Encode(result); err != nil {
		fmt.Fprintln(diagnostics, "cannot write display price check result")
		return 2
	}
	if !result.AllAvailable {
		return 1
	}
	return 0
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}
