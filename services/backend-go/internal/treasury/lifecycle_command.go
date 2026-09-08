package treasury

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
)

func RunLifecycle(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	f := flag.NewFlagSet("treasury-lifecycle", flag.ContinueOnError)
	f.SetOutput(stderr)
	action := f.String("action", "inspect", "inspect, cancel or finalize (unsigned only)")
	manifestPath := f.String("manifest", "", "pinned deployment manifest")
	market := f.String("market", "", "market bytes32 for inspect or cancel")
	epoch := f.Uint64("epoch", 0, "epoch uint32 for inspect or cancel")
	candidate := f.String("candidate", "", "approved candidate ID for finalize")
	sender := f.String("sender", "", "on-chain sender for simulation")
	root := f.String("expected-root", "", "pending root to cancel")
	dataset := f.String("expected-dataset", "", "pending dataset to cancel")
	reason := f.String("reason-hash", "", "nonzero bytes32 cancellation reason commitment")
	if err := f.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 2
	}
	valid := f.NArg() == 0 && *manifestPath != ""
	switch *action {
	case "inspect":
		valid = valid && *market != "" && *epoch > 0 && *epoch <= 1<<32-1 && *candidate == "" && *sender == "" && *root == "" && *dataset == "" && *reason == ""
	case "cancel":
		valid = valid && *market != "" && *epoch > 0 && *epoch <= 1<<32-1 && *candidate == "" && *sender != "" && *root != "" && *dataset != "" && *reason != ""
	case "finalize":
		valid = valid && *candidate != "" && *sender != "" && *market == "" && *epoch == 0 && *root == "" && *dataset == "" && *reason == ""
	default:
		valid = false
	}
	if !valid {
		fmt.Fprintln(stderr, "select inspect/cancel with --market and --epoch, or finalize with --candidate; --manifest required; actions require --sender; cancel requires expected commitments and reason hash")
		return 2
	}
	fail := func(err error) int { fmt.Fprintln(stderr, err); return 1 }
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	raw, err := readJobFile(*manifestPath, 1<<20)
	if err != nil {
		return fail(fmt.Errorf("cannot read lifecycle manifest"))
	}
	manifest, err := deployment.Parse(raw)
	if err != nil {
		return fail(err)
	}
	rpc, err := chainrpc.New(os.Getenv("TG_TREASURY_LIFECYCLE_RPC_URL"))
	if err != nil {
		return fail(fmt.Errorf("cannot configure lifecycle RPC"))
	}
	var result any
	switch *action {
	case "inspect":
		result, err = ObservePendingRoot(ctx, rpc, manifest, *market, uint32(*epoch))
	case "cancel":
		result, err = PrepareCancellation(ctx, rpc, manifest, *market, uint32(*epoch), *sender, *root, *dataset, *reason)
	case "finalize":
		dsn := os.Getenv("TG_TREASURY_LIFECYCLE_DATABASE_URL")
		if dsn == "" {
			return fail(fmt.Errorf("TG_TREASURY_LIFECYCLE_DATABASE_URL is required for finalize"))
		}
		pool, e := postgres.Open(ctx, dsn, 2)
		if e != nil {
			return fail(fmt.Errorf("cannot configure lifecycle review store"))
		}
		defer pool.Close()
		result, err = PrepareFinalization(ctx, pool, rpc, manifest, *candidate, *sender)
	}
	if err != nil {
		return fail(err)
	}
	if err = json.NewEncoder(stdout).Encode(result); err != nil {
		return 1
	}
	return 0
}
