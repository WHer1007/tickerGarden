package treasury

import (
	"bytes"
	"context"
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
)

func jobFixture(t *testing.T) (JobSpec, deployment.Manifest) {
	t.Helper()
	_, rpc, lookup, _, _ := serviceFixture(t)
	in := lookup.candidate.Input
	in.Transfers = []Transfer{}
	// canonicalJob deliberately requires the exclusion list to be explicit.
	if in.ExcludedAccounts == nil {
		in.ExcludedAccounts = []string{}
	}
	return JobSpec{Input: in, Manifest: rpc.manifest}, rpc.manifest
}

func TestCanonicalJobDeterministic(t *testing.T) {
	spec, manifest := jobFixture(t)
	a, payloadA, hashA, err := canonicalJob(spec)
	if err != nil {
		t.Fatal(err)
	}
	// Both manifest order and exclusion order are operator input ordering.
	reordered := spec
	reordered.Manifest = manifest
	reordered.Manifest.Contracts = append([]deployment.Contract{}, manifest.Contracts...)
	for i, j := 0, len(reordered.Manifest.Contracts)-1; i < j; i, j = i+1, j-1 {
		reordered.Manifest.Contracts[i], reordered.Manifest.Contracts[j] = reordered.Manifest.Contracts[j], reordered.Manifest.Contracts[i]
	}
	reordered.Input.ExcludedAccounts = append([]string(nil), spec.Input.ExcludedAccounts...)
	for i, j := 0, len(reordered.Input.ExcludedAccounts)-1; i < j; i, j = i+1, j-1 {
		reordered.Input.ExcludedAccounts[i], reordered.Input.ExcludedAccounts[j] = reordered.Input.ExcludedAccounts[j], reordered.Input.ExcludedAccounts[i]
	}
	b, payloadB, hashB, err := canonicalJob(reordered)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(payloadA, payloadB) || hashA != hashB || !reflect.DeepEqual(a, b) {
		t.Fatal("canonical job is not deterministic")
	}
}

func TestCanonicalJobRejectsInvalidInputs(t *testing.T) {
	base, manifest := jobFixture(t)
	tests := []struct {
		name   string
		mutate func(*JobSpec)
		want   string
	}{
		{"missing core pin", func(s *JobSpec) { s.Manifest.Contracts = s.Manifest.Contracts[:len(s.Manifest.Contracts)-1] }, "complete core"},
		{"duplicate module", func(s *JobSpec) {
			s.Manifest.Contracts = append(s.Manifest.Contracts, deployment.Contract{Module: s.Manifest.Contracts[0].Module, Address: "0x00000000000000000000000000000000000000ff", RuntimeCodeHash: hash([]byte{0})})
		}, "ambiguous"},
		{"chain mismatch", func(s *JobSpec) { s.Manifest.ChainID = 4663 }, "chain mismatch"},
		{"distributor mismatch", func(s *JobSpec) {
			for i := range s.Manifest.Contracts {
				if s.Manifest.Contracts[i].Module == "TreasuryDistributorV1" {
					s.Manifest.Contracts[i].Address = "0x00000000000000000000000000000000000000ff"
				}
			}
		}, "distributor mismatch"},
		{"nonempty transfers", func(s *JobSpec) { s.Input.Transfers = []Transfer{{Value: "1"}} }, "empty Transfers"},
		{"bad policy", func(s *JobSpec) { s.Input.EligibilityPolicyHash = hash([]byte("bad")) }, "policy mismatch"},
		{"unfunded", func(s *JobSpec) { s.Input.QuoteAmount = "0" }, "funded"},
		{"invalid window", func(s *JobSpec) { s.Input.WindowEnd = "0" }, "1 hour"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := base
			s.Manifest = manifest
			s.Manifest.Contracts = append([]deployment.Contract{}, manifest.Contracts...)
			tc.mutate(&s)
			_, _, _, err := canonicalJob(s)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %v, want %q", err, tc.want)
			}
		})
	}
}

func TestRunJobsCLIValidationWithoutDatabase(t *testing.T) {
	for _, args := range [][]string{{}, {"--once", "--run"}, {"--discover", "--manifest", "x"}, {"--enqueue", "x", "--manifest", "x", "--policies", "x"}, {"--status", "0x00", "--manifest", "x"}, {"--help"}} {
		var out, err bytes.Buffer
		code := RunJobs(context.Background(), args, &out, &err)
		if len(args) > 0 && args[len(args)-1] == "--help" {
			if code != 0 {
				t.Fatalf("help returned %d", code)
			}
			continue
		}
		if code != 2 {
			t.Fatalf("args %v returned %d (%s)", args, code, err.String())
		}
	}
}
