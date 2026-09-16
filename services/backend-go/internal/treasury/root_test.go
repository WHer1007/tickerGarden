package treasury

import (
	"bytes"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

type goldenCase struct {
	FinalizeData    string `json:"finalizeData"`
	CancelData      string `json:"cancelData"`
	PublicationData string `json:"publicationData"`
	Name            string `json:"name"`
	Input           Input  `json:"input"`
	Output          Output `json:"output"`
}

func goldens(t *testing.T) []goldenCase {
	t.Helper()
	b, e := os.ReadFile("testdata/golden.json")
	if e != nil {
		t.Fatal(e)
	}
	var data struct {
		Cases []goldenCase `json:"cases"`
	}
	if e = json.Unmarshal(b, &data); e != nil {
		t.Fatal(e)
	}
	if len(data.Cases) != 6 {
		t.Fatal("incomplete golden coverage")
	}
	return data.Cases
}
func TestGenerateMatchesTypeScript(t *testing.T) {
	for _, c := range goldens(t) {
		t.Run(c.Name, func(t *testing.T) {
			actual, e := Generate(c.Input)
			if e != nil {
				t.Fatal(e)
			}
			expected := c.Output
			expected.Context = normalizedContext(expected.Context)
			for i := range expected.Leaves {
				expected.Leaves[i].Account = strings.ToLower(expected.Leaves[i].Account)
			}
			if !reflect.DeepEqual(actual, expected) {
				a, _ := json.Marshal(actual)
				b, _ := json.Marshal(expected)
				t.Fatalf("Go/TS mismatch\n%s\n%s", a, b)
			}
			for _, l := range actual.Leaves {
				if !VerifyProof(l.Leaf, l.Proof, actual.MerkleRoot) {
					t.Fatal("invalid generated proof")
				}
				altered := actual.Context
				altered.EpochID++
				h, e := HashLeaf(altered, l.Index, l.Account, l.Twab, l.Amount)
				if e != nil || VerifyProof(h, l.Proof, actual.MerkleRoot) {
					t.Fatal("epoch replay accepted")
				}
			}
			// Input order cannot influence commitments; canonical log order is authoritative.
			for left, right := 0, len(c.Input.Transfers)-1; left < right; left, right = left+1, right-1 {
				c.Input.Transfers[left], c.Input.Transfers[right] = c.Input.Transfers[right], c.Input.Transfers[left]
			}
			shuffled, e := Generate(c.Input)
			if e != nil || !reflect.DeepEqual(actual, shuffled) {
				t.Fatal("non-deterministic transfer ordering", e)
			}
		})
	}
}
func TestRejectInvalidTreasuryInputs(t *testing.T) {
	for _, name := range []string{"policy", "chain", "duration", "source time", "quote overflow", "noncanonical", "negative balance", "duplicate", "timestamp reversal", "same block timestamp", "future block", "future time", "TWAB overflow", "empty permission"} {
		t.Run(name, func(t *testing.T) {
			in := goldens(t)[0].Input
			switch name {
			case "policy":
				in.EligibilityPolicyHash = "0x" + strings.Repeat("1", 64)
			case "chain":
				in.ChainID = "0"
			case "duration":
				in.WindowEnd = in.WindowStart
			case "source time":
				in.SourceBlockTimestamp = in.WindowStart
			case "quote overflow":
				in.QuoteAmount = new(big.Int).Lsh(big.NewInt(1), 256).String()
			case "noncanonical":
				in.QuoteAmount = "01"
			case "negative balance":
				in.Transfers[0].From = in.Transfers[0].To
			case "duplicate":
				in.Transfers = append(in.Transfers, in.Transfers[0])
			case "timestamp reversal":
				v := in.Transfers[0]
				v.BlockNumber = "2"
				v.Timestamp = "1"
				in.Transfers = append(in.Transfers, v)
			case "same block timestamp":
				v := in.Transfers[0]
				v.TransactionIndex = 1
				v.LogIndex = 1
				v.Timestamp = in.WindowStart
				in.Transfers = append(in.Transfers, v)
			case "future block":
				in.Transfers[0].BlockNumber = "10001"
			case "future time":
				v, _ := strconv.ParseUint(in.SourceBlockTimestamp, 10, 64)
				in.Transfers[0].Timestamp = strconv.FormatUint(v+1, 10)
			case "TWAB overflow":
				in.Transfers[0].Value = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)).String()
			case "empty permission":
				in = goldens(t)[4].Input
				in.EmptyEpochPolicy = ""
			}
			out, e := Generate(in)
			if e == nil || out.Schema != "" {
				t.Fatal("invalid input produced candidate", out, e)
			}
		})
	}
}
func TestWindowBoundaries(t *testing.T) {
	in := goldens(t)[0].Input
	before, e := Generate(in)
	if e != nil {
		t.Fatal(e)
	}
	// A transfer exactly at the end belongs to the next epoch.
	v := in.Transfers[0]
	v.BlockNumber = "2"
	v.Timestamp = in.WindowEnd
	v.From = v.To
	v.To = zero
	in.Transfers = append(in.Transfers, v)
	after, e := Generate(in)
	if e != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("window end included", e)
	}
	// Moving the initial mint to the exact start preserves the entire window.
	in.Transfers = in.Transfers[:1]
	in.Transfers[0].Timestamp = in.WindowStart
	after, e = Generate(in)
	if e != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("window start excluded", e)
	}
}
func TestTreasuryCLIAndStrictJSON(t *testing.T) {
	input, _ := json.Marshal(goldens(t)[0].Input)
	for _, bad := range [][]byte{append(append([]byte{}, input...), []byte(" {}")...), bytes.Replace(input, []byte(`"quoteAmount":`), []byte(`"quoteAmount":"1","quoteAmount":`), 1), bytes.Replace(input, []byte(`"quoteAmount":`), []byte(`"unknown":`), 1), bytes.Repeat([]byte(" "), MaxInputBytes+1)} {
		if _, e := Decode(bad); e == nil {
			t.Fatal("ambiguous input accepted")
		}
	}
	path := filepath.Join(t.TempDir(), "input.json")
	if e := os.WriteFile(path, input, 0600); e != nil {
		t.Fatal(e)
	}
	var out, logs bytes.Buffer
	if code := Run([]string{"--input", path}, &out, &logs); code != 0 {
		t.Fatal(code, logs.String())
	}
	var result struct {
		Status                string
		HistoryVerified       bool
		TransactionSubmission bool
		Dataset               Output
	}
	if e := json.Unmarshal(out.Bytes(), &result); e != nil {
		t.Fatal(e)
	}
	if result.Status != "candidate_unverified_history" || result.HistoryVerified || result.TransactionSubmission || result.Dataset.LeafCount != 1 {
		t.Fatal("overclaimed candidate", result)
	}
	out.Reset()
	logs.Reset()
	if Run(nil, &out, &logs) == 0 || out.Len() != 0 {
		t.Fatal("placeholder daemon appeared to run")
	}
	if !VerifyProof(result.Dataset.Leaves[0].Leaf, []string{}, result.Dataset.MerkleRoot) || VerifyProof("bad", nil, result.Dataset.MerkleRoot) {
		t.Fatal("proof encoding validation")
	}
}

func TestJournalCommandNeedsDedicatedDatabase(t *testing.T) {
	t.Setenv("TG_TREASURY_DATABASE_URL", "")
	input := goldens(t)[0].Input
	input.Transfers = []Transfer{}
	raw, _ := json.Marshal(input)
	path := filepath.Join(t.TempDir(), "request.json")
	if e := os.WriteFile(path, raw, 0600); e != nil {
		t.Fatal(e)
	}
	var out, logs bytes.Buffer
	if Run([]string{"--journal", "--input", path}, &out, &logs) == 0 || out.Len() != 0 || !strings.Contains(logs.String(), "TG_TREASURY_DATABASE_URL") {
		t.Fatal("journal mode did not require dedicated database")
	}
}
