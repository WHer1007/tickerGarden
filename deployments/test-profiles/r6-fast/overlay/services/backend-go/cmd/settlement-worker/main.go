package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/settlement"
	"time"
)

func main() {
	if e := run(os.Args[1:], os.Stdout); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run(args []string, out io.Writer) error {
	if len(args) == 2 && (args[0] == "--sign" || args[0] == "--signed" || args[0] == "--import-signed") {
		return signCommand(args[1], args[0], out)
	}
	if len(args) == 2 && (args[0] == "--prepare-intent" || args[0] == "--intent") {
		return intentCommand(args[1], args[0] == "--prepare-intent", out)
	}
	if len(args) == 4 && args[0] == "--enqueue" && args[2] == "--manifest" {
		return enqueueWork(args[1], args[3], out)
	}
	if len(args) == 2 && (args[0] == "--work-once" || args[0] == "--work-run") {
		return runWork(args[1], args[0] == "--work-run", out)
	}
	if len(args) == 2 && args[0] == "--check-history" {
		return checkHistory(args[1], out)
	}
	if len(args) == 2 && (args[0] == "--submit" || args[0] == "--submission") {
		return submissionCommand(args[1], args[0] == "--submit", out)
	}
	evidenceDir := ""
	record := false
	if len(args) > 4 {
		if args[0] != "--reference-check" && args[0] != "--fetch-reference-check" && args[0] != "--auto-reference-check" {
			return errors.New("persistence requires a reference-check mode")
		}
		extras := args[4:]
		for len(extras) > 0 {
			switch extras[0] {
			case "--record":
				if record {
					return errors.New("duplicate record flag")
				}
				record = true
				extras = extras[1:]
			case "--evidence-dir":
				if evidenceDir != "" || len(extras) < 2 || extras[1] == "" {
					return errors.New("invalid evidence directory flag")
				}
				evidenceDir = extras[1]
				extras = extras[2:]
			default:
				return errors.New("unknown persistence flag")
			}
		}
		args = args[:4]
	}

	if len(args) == 1 && args[0] == "--describe" {
		return json.NewEncoder(out).Encode(map[string]any{"service": "settlement-worker", "implemented": false, "planningImplemented": true, "stateObservationImplemented": true, "observedPlanningImplemented": true, "simulationImplemented": true, "referenceCheckImplemented": true, "referenceFetchImplemented": true, "evidenceExportImplemented": true, "auditPersistenceImplemented": true, "automaticQuoteImplemented": true, "checkSchedulingImplemented": true, "intentPreparationImplemented": true, "signingImplemented": true, "submissionImplemented": true, "executionImplemented": false, "plannedPermission": "SETTLEMENT_OPERATOR", "transactionSubmission": false, "signerConfigured": false})
	}
	if len(args) == 4 && (args[0] == "--observed-request" || args[0] == "--observed-plan" || args[0] == "--preview" || args[0] == "--reference-check" || args[0] == "--fetch-reference-check" || args[0] == "--auto-reference-check" || args[0] == "--quote") && args[2] == "--manifest" {
		var input settlement.ObservedInput
		if e := readStrict(args[1], &input); e != nil {
			return e
		}
		raw, e := readBounded(args[3])
		if e != nil {
			return e
		}
		manifest, e := deployment.Parse(raw)
		if e != nil {
			return e
		}
		rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if e != nil {
			return e
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		if args[0] == "--quote" {
			quote, err := settlement.QuoteConversion(ctx, rpc, manifest, input)
			if err != nil {
				return err
			}
			return json.NewEncoder(out).Encode(map[string]any{"quoteObservation": quote, "candidateOnly": true, "priceReferenceVerified": false, "transactionSubmission": false})
		}
		if args[0] == "--preview" || args[0] == "--reference-check" || args[0] == "--fetch-reference-check" || args[0] == "--auto-reference-check" {
			if args[0] == "--reference-check" || args[0] == "--fetch-reference-check" || args[0] == "--auto-reference-check" {
				var policy settlement.ReferencePolicy
				if e := readStrict(os.Getenv("TG_SETTLEMENT_REFERENCE_POLICY"), &policy); e != nil {
					return e
				}
				var verified settlement.VerifiedConversion
				var e error
				if args[0] == "--auto-reference-check" {
					verified, e = settlement.VerifyAutoConversion(ctx, rpc, manifest, input, policy)
				} else {
					verified, e = settlement.VerifyConversion(ctx, rpc, manifest, input, policy, args[0] == "--fetch-reference-check")
				}
				if e != nil {
					return e
				}
				var result map[string]json.RawMessage
				if e = json.Unmarshal(verified.Result(), &result); e != nil {
					return e
				}
				if record {
					dsn := os.Getenv("TG_SETTLEMENT_DATABASE_URL")
					if dsn == "" {
						return errors.New("TG_SETTLEMENT_DATABASE_URL is required")
					}
					pool, err := postgres.Open(ctx, dsn, 2)
					if err != nil {
						return errors.New("settlement database unavailable")
					}
					defer pool.Close()
					saved, err := (settlement.Store{Pool: pool, ChainID: policy.ChainID}).Record(ctx, verified)
					if err != nil {
						return err
					}
					result["record"], _ = json.Marshal(map[string]any{"sequence": saved.Sequence, "digest": saved.Digest, "status": saved.Status})
				}
				if evidenceDir != "" {
					path, digest, err := writeEvidence(evidenceDir, json.RawMessage(raw), result)
					if err != nil {
						return fmt.Errorf("cannot persist conversion evidence: %w", err)
					}
					result["evidence"], _ = json.Marshal(map[string]string{"path": path, "sha256": digest})
				}
				return json.NewEncoder(out).Encode(result)
			}
			preview, e := settlement.PreviewConversion(ctx, rpc, manifest, input)
			if e != nil {
				return e
			}
			return json.NewEncoder(out).Encode(map[string]any{"preview": preview, "status": "simulated_unsigned", "routeIdentityVerified": true, "vaultCoverageObserved": true, "priceReferenceVerified": false, "solvencyVerified": false, "executionComplete": false, "transactionSubmission": false, "hypotheticalAllocations": true})
		}
		candidate, e := settlement.ObserveCandidate(ctx, rpc, manifest, input, args[0] == "--observed-plan")
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(map[string]any{"candidate": candidate, "candidateOnly": true, "stateObserved": true, "priceReferenceVerified": false, "solvencyVerified": false, "transactionSubmission": false, "executionImplemented": false})
	}
	if len(args) == 4 && args[0] == "--observe-state" && args[2] == "--manifest" {
		return observeState(args[1], args[3], out)
	}
	if len(args) != 2 || (args[0] != "--request" && args[0] != "--plan") {
		return errors.New("usage: settlement-worker --describe | --sign SCOPE_AND_JOB.json | --signed SCOPE_AND_JOB.json | --import-signed RECOVERY.json | --prepare-intent SCOPE_AND_JOB.json | --intent SCOPE_AND_JOB.json | --enqueue WORK.json --manifest DEPLOYMENT.json | --work-once SCOPE.json | --work-run SCOPE.json | --quote INPUT.json --manifest DEPLOYMENT.json | --auto-reference-check INPUT.json --manifest DEPLOYMENT.json | --check-history SCOPE.json | --request INPUT.json | --plan INPUT.json | --observe-state INPUT.json --manifest DEPLOYMENT.json | --observed-request INPUT.json --manifest DEPLOYMENT.json | --observed-plan INPUT.json --manifest DEPLOYMENT.json | --preview INPUT.json --manifest DEPLOYMENT.json | --reference-check INPUT.json --manifest DEPLOYMENT.json | --fetch-reference-check INPUT.json --manifest DEPLOYMENT.json [--record] [--evidence-dir EXISTING_DIRECTORY] (reference-check modes only); execution is not implemented")
	}
	file, e := os.Open(args[1])
	if e != nil {
		return errors.New("cannot open settlement planning input")
	}
	defer file.Close()
	body, e := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if e != nil || len(body) > 1<<20 {
		return errors.New("settlement planning input exceeds 1 MiB or cannot be read")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var input settlement.Input
	if e = decoder.Decode(&input); e != nil {
		return errors.New("invalid settlement planning JSON")
	}
	var extra any
	if e = decoder.Decode(&extra); e != io.EOF {
		return errors.New("settlement planning input must contain one JSON value")
	}
	result := map[string]any{"candidateOnly": true, "onchainVerified": false, "priceReferenceVerified": false, "transactionSubmission": false}
	if args[0] == "--request" {
		r, e := settlement.BuildRequest(input)
		if e != nil {
			return e
		}
		result["request"] = r
	} else {
		p, e := settlement.BuildPlan(input)
		if e != nil {
			return e
		}
		result["plan"] = p
	}
	return json.NewEncoder(out).Encode(result)
}

// Observation inputs deliberately contain no caller-provided reward amounts.
type observationInput struct {
	Operator     string                             `json:"operator"`
	MarketID     string                             `json:"marketId"`
	Participants []deployment.ConversionParticipant `json:"participants"`
}

func readBounded(path string) ([]byte, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, errors.New("cannot open observation input")
	}
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if e != nil || len(raw) > 1<<20 {
		return nil, errors.New("observation input exceeds 1 MiB or cannot be read")
	}
	return raw, nil
}
func readStrict(path string, dst any) error {
	raw, e := readBounded(path)
	if e != nil {
		return e
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if e = d.Decode(dst); e != nil {
		return errors.New("invalid observation JSON")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return errors.New("observation input must contain one JSON value")
	}
	return nil
}
func observeState(inputPath, manifestPath string, out io.Writer) error {
	var input observationInput
	if e := readStrict(inputPath, &input); e != nil {
		return e
	}
	raw, e := readBounded(manifestPath)
	if e != nil {
		return e
	}
	manifest, e := deployment.Parse(raw)
	if e != nil {
		return e
	}
	rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	block, e := rpc.Header(ctx, "latest")
	if e != nil {
		return errors.New("cannot observe current settlement block")
	}
	state, e := deployment.ObserveRewardConversionState(ctx, rpc, manifest, block, input.Operator, input.MarketID, input.Participants)
	if e != nil {
		return e
	}
	return json.NewEncoder(out).Encode(map[string]any{"state": state, "stateObserved": true, "priceReferenceVerified": false, "solvencyVerified": false, "executionImplemented": false, "transactionSubmission": false})
}
