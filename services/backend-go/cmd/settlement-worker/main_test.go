package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tickergarden/backend/internal/settlement"
)

func writeSettlementInput(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "input.json")
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestDescribeAndExecutionFlags(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"--describe"}, &out); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["planningImplemented"] != true || got["executionImplemented"] != false || got["transactionSubmission"] != false {
		t.Fatalf("unexpected describe response: %#v", got)
	}

	input := writeSettlementInput(t, `{"chainId":1,"marketId":"0x1111111111111111111111111111111111111111111111111111111111111111","now":100,"pendingParticipants":[],"rawExitAt":{},"perBatchCap":"10","totalMeme":"10","deadline":200,"slippageBps":0}`)
	for _, args := range [][]string{{"--run", input}, {"--submit", input}} {
		out.Reset()
		if err := run(args, &out); err == nil || out.Len() != 0 {
			t.Fatalf("unsupported execution command produced a result: %v", args)
		}
	}
}

func TestRequestReturnsDigestAndCandidateFlags(t *testing.T) {
	market := "0x1111111111111111111111111111111111111111111111111111111111111111"
	user := "0x2222222222222222222222222222222222222222"
	input := writeSettlementInput(t, `{"chainId":1,"marketId":"`+market+`","now":100,"pendingParticipants":[{"user":"`+user+`","creatorEpoch":7,"maximumMeme":"12"}],"rawExitAt":{},"perBatchCap":"20","totalMeme":"20","deadline":200,"slippageBps":0}`)
	var out bytes.Buffer
	if err := run([]string{"--request", input}, &out); err != nil {
		t.Fatal(err)
	}
	var got struct {
		CandidateOnly          bool               `json:"candidateOnly"`
		OnchainVerified        bool               `json:"onchainVerified"`
		PriceReferenceVerified bool               `json:"priceReferenceVerified"`
		TransactionSubmission  bool               `json:"transactionSubmission"`
		Request                settlement.Request `json:"request"`
	}
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want, err := settlement.RequestDigest(1, market, []settlement.Item{{User: user, CreatorEpoch: 7, MaximumMeme: "12"}})
	if err != nil || got.Request.RequestDigest != want || got.Request.TotalMeme != "12" {
		t.Fatalf("unexpected request: %#v (want digest %s, err %v)", got.Request, want, err)
	}
	if !got.CandidateOnly || got.OnchainVerified || got.PriceReferenceVerified || got.TransactionSubmission {
		t.Fatalf("unexpected execution flags: %#v", got)
	}
}

func TestPlanEmptyHasNoBatches(t *testing.T) {
	input := writeSettlementInput(t, `{"chainId":1,"marketId":"0x1111111111111111111111111111111111111111111111111111111111111111","now":100,"pendingParticipants":[],"rawExitAt":{},"perBatchCap":"10","totalMeme":"10","deadline":200,"slippageBps":0}`)
	var out bytes.Buffer
	if err := run([]string{"--plan", input}, &out); err != nil {
		t.Fatal(err)
	}
	var got struct {
		Plan settlement.Plan `json:"plan"`
	}
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Plan.Batches == nil || len(got.Plan.Batches) != 0 {
		t.Fatalf("expected an empty, non-nil batch list: %#v", got.Plan)
	}
}

func TestInputValidation(t *testing.T) {
	valid := `{"chainId":1,"marketId":"0x1111111111111111111111111111111111111111111111111111111111111111","now":100,"pendingParticipants":[],"rawExitAt":{},"perBatchCap":"10","totalMeme":"10","deadline":200,"slippageBps":0}`
	for _, body := range []string{"{", strings.TrimSuffix(valid, "}") + `,"unknown":1}`, valid + " {}"} {
		path := writeSettlementInput(t, body)
		var out bytes.Buffer
		if err := run([]string{"--plan", path}, &out); err == nil || out.Len() != 0 {
			t.Fatalf("invalid JSON accepted: %q", body)
		}
	}
	var out bytes.Buffer
	if err := run([]string{"--plan", filepath.Join(t.TempDir(), "missing.json")}, &out); err == nil || out.Len() != 0 {
		t.Fatal("missing input was accepted")
	}
	oversized := writeSettlementInput(t, strings.Repeat("x", (1<<20)+1))
	out.Reset()
	if err := run([]string{"--plan", oversized}, &out); err == nil || !strings.Contains(err.Error(), "exceeds 1 MiB") || out.Len() != 0 {
		t.Fatal("oversized input was accepted")
	}
}

func TestExecutionEvidenceCLIRejectsInvalidInputs(t *testing.T) {
	for _, tc := range []struct{ mode, body string }{
		{"--record-execution-evidence", `{}`},
		{"--execution-evidence", `{"jobKey":"x"}`},
		{"--execution-evidence", `{"jobKey":"x","sequence":0}`},
		{"--execution-evidence-history", `{"jobKey":"x","after":-1}`},
		{"--execution-evidence-history", `{"jobKey":"x","sequence":1}`},
	} {
		var out bytes.Buffer
		path := writeSettlementInput(t, tc.body)
		if err := run([]string{tc.mode, path}, &out); err == nil || out.Len() != 0 {
			t.Fatalf("invalid execution evidence input accepted: %s %s", tc.mode, tc.body)
		}
	}
}

func TestObservationInputFailClosed(t *testing.T) {
	t.Setenv("TG_RPC_URL", "")
	for _, body := range []string{`{`, `{"participants":[{"user":"x","creatorEpoch":0,"maximumMeme":"1"}]}`, `{} {}`, strings.Repeat(" ", (1<<20)+1)} {
		var out bytes.Buffer
		input := writeSettlementInput(t, body)
		if e := run([]string{"--observe-state", input, "--manifest", "missing"}, &out); e == nil || out.Len() != 0 {
			t.Fatal("invalid observation input accepted")
		}
	}
	// Preserve the manifest parser's duplicate-key check on the original bytes.
	input := writeSettlementInput(t, `{}`)
	manifest := writeSettlementInput(t, `{"chainId":46630,"chainId":4663}`)
	var out bytes.Buffer
	if e := run([]string{"--observe-state", input, "--manifest", manifest}, &out); e == nil || !strings.Contains(e.Error(), "duplicate") || out.Len() != 0 {
		t.Fatalf("duplicate manifest accepted: %v", e)
	}
	for _, args := range [][]string{{"--observe-state", input}, {"--observe-state", input, "--manifest", manifest, "--submit"}} {
		if e := run(args, &out); e == nil || out.Len() != 0 {
			t.Fatal("invalid command accepted")
		}
	}
}

func TestObservedPlanningRejectsClaimedStateAndExecution(t *testing.T) {
	for _, flag := range []string{"--observed-request", "--observed-plan", "--preview", "--reference-check", "--fetch-reference-check", "--auto-reference-check", "--quote"} {
		for _, body := range []string{`{"now":1}`, `{"chainId":46630}`, `{"rawExitAt":{}}`, `{"state":{}}`, `{"participants":[{"user":"x","availableMeme":"9"}]}`} {
			var out bytes.Buffer
			path := writeSettlementInput(t, body)
			err := run([]string{flag, path, "--manifest", "missing"}, &out)
			if err == nil || err.Error() != "invalid observation JSON" || out.Len() != 0 {
				t.Fatalf("caller chain state accepted: %s %v", body, err)
			}
		}
	}
}
