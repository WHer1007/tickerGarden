package treasury

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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

const MaxInputBytes = 16 << 20

// Decode rejects ambiguous JSON before constructing monetary commitments.
func Decode(data []byte) (Input, error) {
	if len(data) > MaxInputBytes {
		return Input{}, errors.New("Treasury input exceeds size limit")
	}
	if e := rejectAmbiguousJSON(data); e != nil {
		return Input{}, e
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	var input Input
	if e := d.Decode(&input); e != nil {
		return Input{}, errors.New("invalid Treasury input fields")
	}
	if input.Transfers == nil || input.ExcludedAccounts == nil {
		return Input{}, errors.New("Transfer and exclusion arrays required")
	}
	return input, nil
}

func rejectAmbiguousJSON(data []byte) error {
	tokens := json.NewDecoder(bytes.NewReader(data))
	tokens.UseNumber()
	var visit func(int) error
	visit = func(depth int) error {
		if depth > 32 {
			return errors.New("JSON depth exceeded")
		}
		t, e := tokens.Token()
		if e != nil {
			return e
		}
		d, ok := t.(json.Delim)
		if !ok {
			return nil
		}
		switch d {
		case '{':
			seen := map[string]bool{}
			for tokens.More() {
				k, e := tokens.Token()
				if e != nil {
					return e
				}
				key, ok := k.(string)
				key = strings.ToLower(key)
				if !ok || seen[key] {
					return errors.New("duplicate JSON key")
				}
				seen[key] = true
				if e = visit(depth + 1); e != nil {
					return e
				}
			}
		case '[':
			for tokens.More() {
				if e := visit(depth + 1); e != nil {
					return e
				}
			}
		default:
			return errors.New("invalid JSON delimiter")
		}
		_, e = tokens.Token()
		return e
	}
	if e := visit(0); e != nil {
		return errors.New("invalid or ambiguous Treasury JSON")
	}
	if _, e := tokens.Token(); e != io.EOF {
		return errors.New("trailing Treasury JSON")
	}
	return nil
}

func Run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("treasury-worker", flag.ContinueOnError)
	flags.SetOutput(stderr)
	store := flags.Bool("store", false, "persist a verified candidate using TG_TREASURY_STORE_DATABASE_URL")
	requestManifest := flags.String("request-manifest", "", "verify finalized on-chain request against a pinned deployment manifest; requires --journal")
	journal := flags.Bool("journal", false, "load Transfers from TG_TREASURY_DATABASE_URL; supplied Transfer array must be empty")
	describe := flags.Bool("describe", false, "describe candidate computation and unfinished scheduling")
	path := flags.String("input", "", "compute a candidate dataset from a local JSON file")
	if e := flags.Parse(args); e != nil {
		if e == flag.ErrHelp {
			return 0
		}
		return 2
	}
	if (*store && *requestManifest == "") || flags.NArg() != 0 || (*requestManifest != "" && !*journal) || (*describe && (*path != "" || *journal || *requestManifest != "" || *store)) {
		fmt.Fprintln(stderr, "unexpected Treasury arguments")
		return 2
	}
	if *describe {
		if e := json.NewEncoder(stdout).Encode(map[string]any{"service": "treasury-worker", "stage": "candidate-computation", "computationImplemented": true, "scheduledWorkerImplemented": true, "durableJobQueueImplemented": true, "jobCommand": "treasury-jobs", "historyVerificationImplemented": false, "journalRangeLoaderImplemented": true, "transactionSubmission": false}); e != nil {
			return 1
		}
		return 0
	}
	if *path == "" {
		fmt.Fprintln(stderr, "treasury-worker: use --input FILE or --describe; use treasury-jobs for durable operator-enqueued work; use --policies with treasury-jobs for RootRequested discovery")
		return 2
	}
	file, e := os.Open(*path)
	if e != nil {
		fmt.Fprintln(stderr, "cannot open Treasury input")
		return 1
	}
	defer file.Close()
	data, e := io.ReadAll(io.LimitReader(file, MaxInputBytes+1))
	if e != nil {
		fmt.Fprintln(stderr, "cannot read Treasury input")
		return 1
	}
	input, e := Decode(data)
	if e != nil {
		fmt.Fprintln(stderr, e)
		return 1
	}
	var evidence *JournalEvidence
	if *journal {
		dsn := os.Getenv("TG_TREASURY_DATABASE_URL")
		if dsn == "" {
			fmt.Fprintln(stderr, "TG_TREASURY_DATABASE_URL is required")
			return 1
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		pool, err := postgres.Open(ctx, dsn, 2)
		if err != nil {
			fmt.Fprintln(stderr, "cannot configure Treasury journal")
			return 1
		}
		defer pool.Close()
		loaded, proof, err := LoadJournalInput(ctx, pool, input)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		input = loaded
		evidence = &proof
	}
	out, e := Generate(input)
	if e != nil {
		fmt.Fprintln(stderr, e)
		return 1
	}
	var request *deployment.TreasuryRequestSnapshot
	if *requestManifest != "" {
		f, err := os.Open(*requestManifest)
		if err != nil {
			fmt.Fprintln(stderr, "cannot open request deployment manifest")
			return 1
		}
		data, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
		f.Close()
		if err != nil {
			fmt.Fprintln(stderr, "cannot read request deployment manifest")
			return 1
		}
		m, err := deployment.Parse(data)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		block, err := rpc.Header(ctx, "finalized")
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		observed, err := deployment.ObserveTreasuryRequest(ctx, rpc, m, block, input.MarketID, input.EpochID)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if err = MatchRequest(input, observed); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		request = &observed
		evidence.RootRequestVerified = true
	}
	candidateID := ""
	if *store {
		dsn := os.Getenv("TG_TREASURY_STORE_DATABASE_URL")
		if dsn == "" {
			fmt.Fprintln(stderr, "TG_TREASURY_STORE_DATABASE_URL is required")
			return 1
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		pool, err := postgres.Open(ctx, dsn, 2)
		if err != nil {
			fmt.Fprintln(stderr, "cannot configure candidate store")
			return 1
		}
		defer pool.Close()
		candidateID, err = SaveCandidate(ctx, pool, Candidate{Input: input, Dataset: out, Journal: *evidence, Request: *request})
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	// Do not let a successful pure computation imply a provenance or authority gate.
	e = json.NewEncoder(stdout).Encode(struct {
		CandidateID           string                              `json:"candidateId,omitempty"`
		Status                string                              `json:"status"`
		HistoryVerified       bool                                `json:"historyVerified"`
		TransactionSubmission bool                                `json:"transactionSubmission"`
		Dataset               Output                              `json:"dataset"`
		JournalEvidence       *JournalEvidence                    `json:"journalEvidence,omitempty"`
		RequestEvidence       *deployment.TreasuryRequestSnapshot `json:"requestEvidence,omitempty"`
	}{CandidateID: candidateID, Status: "candidate_unverified_history", Dataset: out, JournalEvidence: evidence, RequestEvidence: request})
	if e != nil {
		return 1
	}
	return 0
}
