package treasury

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func normalizedGenerate(in Input) Output {
	out, err := Generate(in)
	if err != nil {
		panic(err)
	}
	out.Context = normalizedContext(out.Context)
	for i := range out.Leaves {
		out.Leaves[i].Account = strings.ToLower(out.Leaves[i].Account)
	}
	return out
}

func TestDecodeDatasetMatchesAllGoldens(t *testing.T) {
	for _, golden := range goldens(t) {
		t.Run(golden.Name, func(t *testing.T) {
			data, err := json.Marshal(golden.Output)
			if err != nil {
				t.Fatal(err)
			}
			got, err := DecodeDataset(data)
			if err != nil {
				t.Fatal(err)
			}
			want := normalizedGenerate(golden.Input)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("decoded dataset differs from generated output")
			}
		})
	}
}

func TestDecodeDatasetRejectsAmbiguousOrInvalidJSON(t *testing.T) {
	base, err := json.Marshal(goldens(t)[0].Output)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{
		"unknown":     string(base[:len(base)-1]) + `,"unknown":true}`,
		"duplicate":   string(base[:len(base)-1]) + `,"schema":"` + Schema + `"}`,
		"schema":      strings.Replace(string(base), `"schema":"`+Schema+`"`, `"schema":"wrong"`, 1),
		"null leaves": strings.Replace(string(base), `"leaves":[`, `"leaves":null,`, 1),
	}
	var nullLeaves map[string]any
	if e := json.Unmarshal(base, &nullLeaves); e != nil {
		t.Fatal(e)
	}
	nullLeaves["leaves"] = nil
	validNullJSON, _ := json.Marshal(nullLeaves)
	cases["null leaves"] = string(validNullJSON)
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeDataset([]byte(data)); err == nil {
				t.Fatal("accepted invalid dataset")
			}
		})
	}
}

func TestCompareReview(t *testing.T) {
	c, _ := claimFixture(t, 0)
	report := HistoryReport{CandidateID: "candidate", InputDigest: InputDigest(c.Input), HistoryComplete: true, Method: "independent replay", Evidence: "journal and source records"}
	if err := compareReview(c, "candidate", c.Dataset, report, "approved", "matches independently recomputed dataset"); err != nil {
		t.Fatal(err)
	}
	empty := c
	empty.Dataset.Leaves = []Leaf{}
	empty.Dataset.LeafCount = 0
	report.EmptyEpochReviewed = true
	if err := compareReview(empty, "candidate", empty.Dataset, report, "approved", "empty epoch reviewed"); err != nil {
		t.Fatal(err)
	}
	report.EmptyEpochReviewed = false
	if err := compareReview(empty, "candidate", empty.Dataset, report, "approved", "empty epoch reviewed"); err == nil {
		t.Fatal("accepted unreviewed empty epoch")
	}
	report.HistoryComplete = false
	if err := compareReview(c, "candidate", c.Dataset, report, "approved", "incomplete history"); err == nil {
		t.Fatal("accepted incomplete history")
	}
	report.HistoryComplete = true
	bad := c.Dataset
	bad.DatasetHash = emptyRoot
	if err := compareReview(c, "candidate", bad, report, "approved", "mismatch"); err == nil {
		t.Fatal("accepted mismatching reference")
	}
	report.HistoryComplete = false
	if err := compareReview(c, "candidate", bad, report, "rejected", "rejected after review"); err != nil {
		t.Fatal(err)
	}
}

func TestRunReviewModesAndNoDB(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want int
	}{
		{"help", []string{"-h"}, 0},
		{"invalid mode", []string{}, 2},
		{"multiple modes", []string{"-export-input", "a", "-show", "b"}, 2},
		{"no database", []string{"-export-input", "candidate"}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TG_TREASURY_REVIEW_DATABASE_URL", "")
			var out, stderr bytes.Buffer
			if got := RunReview(context.Background(), tc.args, &out, &stderr); got != tc.want {
				t.Fatalf("status=%d stderr=%s", got, stderr.String())
			}
		})
	}
}

func TestPublicationCalldataMatchesCompiledABIAndViem(t *testing.T) {
	for _, golden := range goldens(t) {
		output, err := Generate(golden.Input)
		if err != nil {
			t.Fatal(err)
		}
		if actual := publishData(Candidate{Input: golden.Input, Dataset: output}); actual != golden.PublicationData {
			t.Fatal("publishRoot ABI mismatch", golden.Name, actual, golden.PublicationData)
		}
	}
}
