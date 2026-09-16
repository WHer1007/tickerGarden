package treasury

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"time"
)

func RunReview(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	f := flag.NewFlagSet("treasury-review", flag.ContinueOnError)
	f.SetOutput(stderr)
	operation := f.String("operation-id", "", "stable bytes32 identifier for one review decision")
	template := f.String("report-template", "", "export report template bound to candidate input")
	prepare := f.String("prepare-publication", "", "simulate unsigned publication for approved candidate")
	publisher := f.String("publisher", "", "on-chain publisher sender for simulation")
	export := f.String("export-input", "", "export exact candidate input for independent recomputation")
	show := f.String("show", "", "show latest review for candidate ID")
	id := f.String("candidate", "", "candidate ID to review")
	decision := f.String("decision", "", "approved or rejected")
	reason := f.String("reason", "", "review reason")
	reportPath := f.String("history-report", "", "explicit history completeness/evidence report JSON")
	referencePath := f.String("reference", "", "independently computed Treasury output JSON")
	manifestPath := f.String("manifest", "", "pinned deployment manifest")
	if err := f.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 2
	}
	n := 0
	for _, v := range []string{*export, *show, *id, *prepare, *template} {
		if v != "" {
			n++
		}
	}
	if n != 1 || f.NArg() != 0 || (*id != "" && (!hashRE.MatchString(*operation) || *operation != strings.ToLower(*operation) || *manifestPath == "" || *reportPath == "" || !reviewText(*reason, 4096) || (*decision != "approved" && *decision != "rejected") || (*decision == "approved" && *referencePath == ""))) || (*prepare != "" && (*publisher == "" || *manifestPath == "" || *decision != "" || *reason != "" || *reportPath != "" || *referencePath != "")) || (*id == "" && *operation != "") || (*prepare == "" && *publisher != "") || (*id == "" && *prepare == "" && (*manifestPath != "" || *decision != "" || *reason != "" || *reportPath != "" || *referencePath != "")) {
		fmt.Fprintln(stderr, "select --export-input ID, --show ID or --candidate ID with --decision, --reason, --history-report, --manifest; approval also requires --reference")
		return 2
	}
	fail := func(message string) int { fmt.Fprintln(stderr, message); return 1 }
	ctx, cancel := context.WithTimeout(ctx, 75*time.Second)
	defer cancel()
	dsnName := "TG_TREASURY_REVIEW_DATABASE_URL"
	if *prepare != "" {
		dsnName = "TG_TREASURY_PUBLISH_DATABASE_URL"
	}
	dsn := os.Getenv(dsnName)
	if dsn == "" {
		return fail(dsnName + " is required")
	}
	store, err := postgres.Open(ctx, dsn, 3)
	if err != nil {
		return fail("cannot configure independent review store")
	}
	defer store.Close()

	if *prepare != "" {
		raw, e := readJobFile(*manifestPath, 1<<20)
		if e != nil {
			return fail("cannot read publication manifest")
		}
		manifest, e := deployment.Parse(raw)
		if e != nil {
			return fail(e.Error())
		}
		rpc, e := chainrpc.New(os.Getenv("TG_TREASURY_PUBLISH_RPC_URL"))
		if e != nil {
			return fail("cannot configure publisher simulation RPC")
		}
		plan, e := PreparePublication(ctx, store, rpc, manifest, *prepare, *publisher)
		if e != nil {
			return fail(e.Error())
		}
		if json.NewEncoder(stdout).Encode(plan) != nil {
			return 1
		}
		return 0
	}

	if *template != "" {
		candidate, e := ReadCandidate(ctx, store, *template)
		if e != nil {
			return fail(e.Error())
		}
		if json.NewEncoder(stdout).Encode(HistoryReport{CandidateID: *template, InputDigest: InputDigest(candidate.Input)}) != nil {
			return 1
		}
		return 0
	}
	if *export != "" {
		candidate, e := ReadCandidate(ctx, store, *export)
		if e != nil {
			return fail(e.Error())
		}
		if json.NewEncoder(stdout).Encode(candidate.Input) != nil {
			return 1
		}
		return 0
	}
	if *show != "" {
		review, e := LatestReview(ctx, store, *show)
		if e != nil {
			return fail(e.Error())
		}
		if json.NewEncoder(stdout).Encode(review) != nil {
			return 1
		}
		return 0
	}
	data, err := readJobFile(*manifestPath, 1<<20)
	if err != nil {
		return fail("cannot read review deployment manifest")
	}
	manifest, err := deployment.Parse(data)
	if err != nil {
		return fail(err.Error())
	}
	data, err = readJobFile(*reportPath, 1<<20)
	if err != nil {
		return fail("cannot read history review report")
	}
	report, err := DecodeHistoryReport(data)
	if err != nil {
		return fail(err.Error())
	}
	var reference Output
	if *referencePath != "" {
		data, err = readJobFile(*referencePath, 128<<20)
		if err != nil {
			return fail("cannot read independent dataset")
		}
		reference, err = DecodeDataset(data)
		if err != nil {
			return fail(err.Error())
		}
	}
	if *decision == "rejected" {
		reviewID, e := RecordReview(ctx, store, nil, nil, manifest, *id, *operation, reference, report, *decision, *reason)
		if e != nil {
			return fail(e.Error())
		}
		if json.NewEncoder(stdout).Encode(map[string]string{"reviewId": reviewID, "decision": "rejected"}) != nil {
			return 1
		}
		return 0
	}
	journalDSN := os.Getenv("TG_TREASURY_REVIEW_JOURNAL_URL")
	if journalDSN == "" {
		return fail("TG_TREASURY_REVIEW_JOURNAL_URL is required for approval")
	}
	journal, err := postgres.Open(ctx, journalDSN, 2)
	if err != nil {
		return fail("cannot configure review journal")
	}
	defer journal.Close()
	rpc, err := chainrpc.New(os.Getenv("TG_TREASURY_REVIEW_RPC_URL"))
	if err != nil {
		return fail("cannot configure independent review RPC")
	}
	reviewID, err := RecordReview(ctx, store, journal, rpc, manifest, *id, *operation, reference, report, *decision, *reason)
	if err != nil {
		return fail(err.Error())
	}
	if json.NewEncoder(stdout).Encode(map[string]string{"reviewId": reviewID, "decision": "approved"}) != nil {
		return 1
	}
	return 0
}
