// settlement-executor resumes an explicitly selected, already checked job.
// It never discovers candidates, changes fee policy or imports signing material.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/settlement"
	"time"
)

var errRuntimeDatabase = errors.New("settlement database unavailable")
var errRuntimeRPC = errors.New("settlement RPC unavailable")

type executorJob struct {
	settlement.WorkScope
	JobKey string `json:"jobKey"`
}

type executionRuntime interface {
	AdvanceExecution(context.Context, settlement.WorkScope, string, settlement.ExecutionPolicy) (settlement.ExecutionProgress, error)
	Close()
}

type storeRuntime struct {
	pool   interface{ Close() }
	store  settlement.Store
	rpc    settlement.ExecutionRPC
	signer settlement.Signer
}

func (r *storeRuntime) AdvanceExecution(ctx context.Context, scope settlement.WorkScope, key string, fees settlement.ExecutionPolicy) (settlement.ExecutionProgress, error) {
	return r.store.AdvanceExecution(ctx, r.rpc, r.signer, scope, key, fees)
}

func (r *storeRuntime) Close() { r.pool.Close() }

type executorDependencies struct {
	getenv      func(string) string
	stat        func(string) (os.FileInfo, error)
	openRuntime func(context.Context, executorJob, string, string, string) (executionRuntime, error)
	wait        func(context.Context, time.Duration) bool
}

func productionDependencies() executorDependencies {
	return executorDependencies{
		getenv: os.Getenv,
		stat:   os.Stat,
		openRuntime: func(ctx context.Context, input executorJob, dsn, rpcURL, signerPath string) (executionRuntime, error) {
			pool, err := postgres.Open(ctx, dsn, 4)
			if err != nil {
				return nil, errRuntimeDatabase
			}
			rpc, err := chainrpc.New(rpcURL)
			if err != nil {
				pool.Close()
				return nil, errRuntimeRPC
			}
			return &storeRuntime{pool: pool, store: settlement.Store{Pool: pool, ChainID: input.ChainID}, rpc: rpc, signer: settlement.ExecSigner{Path: signerPath}}, nil
		},
		wait: func(ctx context.Context, duration time.Duration) bool {
			timer := time.NewTimer(duration)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return false
			case <-timer.C:
				return true
			}
		},
	}
}

func read(path string, v any) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	body, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if e != nil || len(body) > 1<<20 {
		return fmt.Errorf("executor input exceeds size limit or cannot be read")
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.DisallowUnknownFields()
	if e = d.Decode(v); e != nil {
		return e
	}
	if d.Decode(new(any)) != io.EOF {
		return fmt.Errorf("extra input")
	}
	return nil
}
func run(ctx context.Context, args []string, out, errOut io.Writer) int {
	return runWithDependencies(ctx, args, out, errOut, productionDependencies())
}

func runWithDependencies(ctx context.Context, args []string, out, errOut io.Writer, deps executorDependencies) int {
	fail := func(s string) int { fmt.Fprintln(errOut, s); return 1 }
	if len(args) == 1 && args[0] == "--describe" {
		if json.NewEncoder(out).Encode(map[string]any{"service": "settlement-executor", "explicitJobRequired": true, "maySignAndSubmit": true, "automaticCandidateSelection": false, "nonceReuse": false}) != nil {
			return 1
		}
		return 0
	}
	if len(args) != 2 || (args[0] != "--once" && args[0] != "--run") {
		return fail("usage: settlement-executor --describe | --once JOB.json | --run JOB.json (may sign and broadcast the selected job)")
	}
	var input executorJob
	if read(args[1], &input) != nil {
		return fail("invalid executor job file")
	}
	var fees settlement.ExecutionPolicy
	if deps.getenv == nil || deps.stat == nil || deps.openRuntime == nil || deps.wait == nil || read(deps.getenv("TG_SETTLEMENT_EXECUTION_POLICY"), &fees) != nil {
		return fail("invalid settlement execution policy")
	}
	signerPath := deps.getenv("TG_SETTLEMENT_SIGNER_COMMAND")
	st, e := deps.stat(signerPath)
	if e != nil || !filepath.IsAbs(signerPath) || !st.Mode().IsRegular() || st.Mode()&0111 == 0 {
		return fail("settlement signer executable unavailable")
	}
	dsn := deps.getenv("TG_SETTLEMENT_DATABASE_URL")
	if dsn == "" {
		return fail("TG_SETTLEMENT_DATABASE_URL is required")
	}
	runtime, e := deps.openRuntime(ctx, input, dsn, deps.getenv("TG_RPC_URL"), signerPath)
	if e != nil || runtime == nil {
		if errors.Is(e, errRuntimeDatabase) {
			return fail(errRuntimeDatabase.Error())
		}
		if errors.Is(e, errRuntimeRPC) {
			return fail(errRuntimeRPC.Error())
		}
		return fail("settlement runtime unavailable")
	}
	defer runtime.Close()
	for {
		step, cancel := context.WithTimeout(ctx, 5*time.Minute)
		progress, e := runtime.AdvanceExecution(step, input.WorkScope, input.JobKey, fees)
		cancel()
		if ctx.Err() != nil {
			return 0
		}
		if e != nil {
			return fail("settlement execution stopped; inspect durable intent and evidence before retrying")
		}
		if json.NewEncoder(out).Encode(progress) != nil {
			return fail("cannot write execution progress")
		}
		if progress.State == "accounting_verified" {
			return 0
		}
		if args[0] == "--once" || progress.State == "signing_reconciliation_required" || progress.State == "finalized_reverted" {
			return 2
		}
		if !deps.wait(ctx, 5*time.Second) {
			return 0
		}
	}
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Stdout, os.Stderr))
}
