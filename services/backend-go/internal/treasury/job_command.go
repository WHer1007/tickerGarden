package treasury

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"time"
)

func RunJobs(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("treasury-jobs", flag.ContinueOnError)
	flags.SetOutput(stderr)
	input := flags.String("enqueue", "", "enqueue request JSON with empty transfers")
	manifestPath := flags.String("manifest", "", "pinned Go deployment manifest")
	history := flags.String("history", "", "read up to 100 audit events for job ID")
	after := flags.Int64("after", 0, "exclusive audit sequence cursor for --history")
	retry := flags.String("retry", "", "recover a dead job using operator DSN")
	operation := flags.String("operation-id", "", "stable bytes32 recovery operation ID")
	reason := flags.String("reason", "", "operator recovery reason")
	expected := flags.Int("expected-recovery", -1, "expected current recoveryCount")
	status := flags.String("status", "", "inspect a job ID")
	discover := flags.Bool("discover", false, "discover finalized RootRequested events and enqueue known policies")
	policyPath := flags.String("policies", "", "eligibility policy JSON; enables discovery before work")
	once := flags.Bool("once", false, "process at most one queued job")
	run := flags.Bool("run", false, "process queued jobs until shutdown")
	if err := flags.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 2
	}
	modes := 0
	for _, v := range []bool{*input != "", *status != "", *once, *run, *discover, *history != "", *retry != ""} {
		if v {
			modes++
		}
	}

	inspect := *status != "" || *history != "" || *retry != ""
	if (*discover && *policyPath == "") || (*policyPath != "" && !(*once || *run || *discover)) || modes != 1 || flags.NArg() != 0 || (!inspect && *manifestPath == "") || (inspect && *manifestPath != "") || (*history == "" && *after != 0) || *after < 0 || (*retry == "" && (*operation != "" || *reason != "" || *expected != -1)) || (*retry != "" && !validRecovery(*retry, *operation, *reason, *expected)) {
		fmt.Fprintln(stderr, "select one queue mode; work/discover/enqueue require --manifest; retry requires --operation-id, --reason and --expected-recovery")
		return 2
	}
	fail := func(message string) int { fmt.Fprintln(stderr, message); return 1 }
	var manifest deployment.Manifest
	if *manifestPath != "" {
		data, err := readJobFile(*manifestPath, 1<<20)
		if err != nil {
			return fail("cannot read job deployment manifest")
		}
		manifest, err = deployment.Parse(data)
		if err != nil {
			return fail(err.Error())
		}
		manifest, _, err = jobManifest(manifest)
		if err != nil {
			return fail(err.Error())
		}
	}
	dsnName := "TG_TREASURY_JOBS_DATABASE_URL"
	if *retry != "" {
		dsnName = "TG_TREASURY_OPERATOR_DATABASE_URL"
	}
	dsn := os.Getenv(dsnName)
	if dsn == "" {
		return fail(dsnName + " is required")
	}
	pool, err := postgres.Open(ctx, dsn, 3)
	if err != nil {
		return fail("cannot configure Treasury job store")
	}
	defer pool.Close()
	queue := JobQueue{Pool: pool}

	if *history != "" {
		op, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		items, err := queue.History(op, *history, *after)
		if err != nil {
			return fail(err.Error())
		}
		next := *after
		if len(items) > 0 {
			next = items[len(items)-1].Sequence
		}
		if json.NewEncoder(stdout).Encode(map[string]any{"items": items, "nextAfter": next}) != nil {
			return 1
		}
		return 0
	}
	if *retry != "" {
		rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if err != nil {
			return fail("cannot configure recovery RPC")
		}
		result, err := queue.Recover(ctx, rpc, *retry, *operation, *reason, *expected)
		if err != nil {
			return fail(err.Error())
		}
		if json.NewEncoder(stdout).Encode(result) != nil {
			return 1
		}
		return 0
	}
	if *status != "" {
		op, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		j, err := queue.Status(op, *status)
		if err != nil {
			return fail(err.Error())
		}
		if json.NewEncoder(stdout).Encode(j) != nil {
			return 1
		}
		return 0
	}
	if *input != "" {
		data, err := readJobFile(*input, MaxInputBytes)
		if err != nil {
			return fail("cannot read queued request")
		}
		in, err := Decode(data)
		if err != nil {
			return fail(err.Error())
		}
		op, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		id, err := queue.Enqueue(op, JobSpec{Input: in, Manifest: manifest})
		if err != nil {
			return fail(err.Error())
		}
		if json.NewEncoder(stdout).Encode(map[string]string{"jobId": id}) != nil {
			return 1
		}
		return 0
	}

	rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if err != nil {
		return fail("cannot configure Treasury RPC")
	}
	discoverOnce := func() (DiscoveryResult, error) {
		data, e := readJobFile(*policyPath, 1<<20)
		if e != nil {
			return DiscoveryResult{}, e
		}
		policies, e := DecodePolicies(data)
		if e != nil {
			return DiscoveryResult{}, e
		}
		return DiscoverRequests(ctx, pool, rpc, manifest, policies)
	}
	if *discover {
		result, e := discoverOnce()
		if e != nil {
			return fail("Treasury request discovery failed; no partial batch committed")
		}
		if json.NewEncoder(stdout).Encode(result) != nil {
			return 1
		}
		return 0
	}
	journalDSN := os.Getenv("TG_TREASURY_DATABASE_URL")
	if journalDSN == "" {
		return fail("TG_TREASURY_DATABASE_URL is required")
	}
	journal, err := postgres.Open(ctx, journalDSN, 2)
	if err != nil {
		return fail("cannot configure Treasury journal")
	}
	defer journal.Close()
	for {
		if ctx.Err() != nil {
			return 0
		}

		if *policyPath != "" {
			discovered, e := discoverOnce()
			if e != nil {
				fmt.Fprintln(stderr, "Treasury request discovery failed; existing jobs remain processable")
				if *once {
					return 1
				}
			} else if discovered.Queued+discovered.Inactive+discovered.AwaitingPolicy > 0 {
				if json.NewEncoder(stdout).Encode(discovered) != nil {
					return 1
				}
			}
		}
		op, cancel := context.WithTimeout(ctx, 75*time.Second)
		job, err := ProcessJobOnce(op, queue, journal, rpc, manifest)
		cancel()
		if err == nil {
			if json.NewEncoder(stdout).Encode(job) != nil {
				return 1
			}
		} else if !errors.Is(err, ErrNoJob) {
			fmt.Fprintln(stderr, "Treasury job processing unavailable or failed; inspect queue status")
		}
		if *once {
			if errors.Is(err, ErrNoJob) {
				if json.NewEncoder(stdout).Encode(map[string]string{"status": "idle"}) != nil {
					return 1
				}
				return 0
			}
			if err != nil {
				return 1
			}
			return 0
		}
		if err == nil {
			continue
		}
		timer := time.NewTimer(5 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return 0
		case <-timer.C:
		}
	}
}
func readJobFile(path string, max int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil || int64(len(data)) > max {
		return nil, errors.New("file exceeds budget or cannot be read")
	}
	return data, nil
}
