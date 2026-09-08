// candidate-inspect reads and validates local candidate evidence. Inspection
// modes are read-only. The explicit --publish mode runs the complete dual-RPC
// gate and atomically writes a snapshot plus its evidence; it never submits a tx.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"syscall"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/projector"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/treasury"
	"time"
)

func main() {
	if e := run(os.Args[1:], os.Getenv, os.Stdout); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run(args []string, env func(string) string, out io.Writer) error {
	if len(args) == 1 && args[0] == "--describe" {
		return json.NewEncoder(out).Encode(map[string]any{"service": "candidate-inspect", "readOnly": true, "inspectionReadOnly": true, "verifiedPublicationMode": true, "publicationEligible": false, "transactionSubmission": false, "independentEmitterAuthentication": false, "projectorVersion": projector.Version, "observationScope": projector.ObservationScope})
	}
	publishMode := len(args) == 1 && args[0] == "--publish"
	verifyAssets := len(args) == 2 && args[0] == "--once" && args[1] == "--verify-assets-rpc"
	verifyRPC := len(args) == 2 && args[0] == "--once" && args[1] == "--verify-static-rpc"
	if !publishMode && !verifyAssets && !verifyRPC && (len(args) != 1 || args[0] != "--once") {
		return errors.New("usage: candidate-inspect --describe | --once [--verify-static-rpc | --verify-assets-rpc] | --publish")
	}
	startText := env("TG_PROJECTION_START_BLOCK")
	start, e := strconv.ParseUint(startText, 10, 63)
	if e != nil || strconv.FormatUint(start, 10) != startText {
		return errors.New("TG_PROJECTION_START_BLOCK must be a canonical nonnegative integer")
	}
	dsn := env("TG_CANDIDATE_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_CANDIDATE_DATABASE_URL is required")
	}
	file, e := os.Open(env("TG_DEPLOYMENT_MANIFEST"))
	if e != nil {
		return errors.New("cannot open TG_DEPLOYMENT_MANIFEST")
	}
	defer file.Close()
	data, e := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if e != nil {
		return errors.New("cannot read deployment manifest")
	}
	manifest, e := deployment.Parse(data)
	if e != nil {
		return errors.New("invalid deployment manifest")
	}
	sort.Slice(manifest.Contracts, func(i, j int) bool { return manifest.Contracts[i].Address < manifest.Contracts[j].Address })
	canonical, e := json.Marshal(manifest)
	if e != nil {
		return errors.New("cannot encode deployment scope")
	}
	parent, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	timeout := 30 * time.Second
	if publishMode {
		timeout = 2 * time.Minute
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, 2)
	if e != nil {
		return errors.New("cannot configure candidate database")
	}
	defer pool.Close()
	store := readmodel.ObservationStore{EmitterManifest: &manifest, Pool: pool, ChainID: manifest.ChainID, GenesisHash: manifest.GenesisHash, ManifestHash: deployment.Hash(canonical), Version: projector.Version, Scope: projector.ObservationScope, StartBlock: start}
	candidate, e := store.LoadCandidateSet(ctx)
	if e != nil {
		return e
	}
	if verifyRPC || verifyAssets || publishMode {
		rpc, e := chainrpc.New(env("TG_CANDIDATE_RPC_URL"))
		if e != nil {
			return errors.New("invalid TG_CANDIDATE_RPC_URL")
		}
		var checkErr error
		if verifyAssets || publishMode {
			checkErr = verifyHistoryOrigin(ctx, rpc, manifest, candidate)
			if checkErr == nil {
				checkErr = verifyCandidateAssets(ctx, rpc, manifest, candidate)
			}
			if checkErr == nil {
				checkErr = verifyCandidateTreasuryArtifacts(ctx, treasury.CandidateStore{Pool: pool}, candidate)
			}
			if checkErr == nil {
				checkErr = verifyCandidateBlockCoverage(ctx, rpc, manifest, candidate)
			}
			if checkErr == nil {
				checkErr = verifyStaticCandidate(ctx, rpc, manifest, candidate)
			}
		} else {
			checkErr = verifyStaticCandidate(ctx, rpc, manifest, candidate)
		}
		if e := checkErr; e != nil {
			return e
		}
		if publishMode {
			return publishVerifiedCandidate(ctx, env, out, store, manifest, deployment.Hash(canonical), candidate, rpc)
		}
	}
	return json.NewEncoder(out).Encode(map[string]any{"service": "candidate-inspect", "readOnly": true, "transactionSubmission": false, "independentEmitterAuthentication": false, "fullFinancialReconciliation": false, "staticRuntimeAtCandidateVerified": verifyRPC || verifyAssets, "assetIdentitiesAtCandidateVerified": verifyAssets, "vaultPrincipalAtCandidateVerified": verifyAssets, "marketRoutesAtCandidateVerified": verifyAssets, "curveProgressAtCandidateVerified": verifyAssets, "configValuesAtCandidateVerified": verifyAssets, "gaugePositionsAtCandidateVerified": verifyAssets, "knownMarketFeeCoverageAtCandidateVerified": verifyAssets, "eventDerivedFeeLiabilitiesAtCandidateVerified": verifyAssets && len(candidate.Markets) > 0, "creatorEpochLiabilitiesAtCandidateVerified": verifyAssets, "eventDerivedCreatorEpochLiabilitiesAtCandidateVerified": verifyAssets && len(candidate.Markets) > 0, "knownHolderCoverageAtCandidateVerified": verifyAssets, "eventDerivedHolderEpochLiabilitiesAtCandidateVerified": verifyAssets && len(candidate.HolderMarkets) > 0, "treasuryDatasetsAtCandidateVerified": verifyAssets, "candidateReceiptRootVerified": verifyAssets && candidate.HistoryReceiptRootsVerified, "candidateEventCoverageVerified": verifyAssets && candidate.HistoryEventCoverageVerified, "historyOriginChecked": verifyAssets, "candidate": candidate})
}
