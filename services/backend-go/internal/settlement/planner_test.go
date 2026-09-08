package settlement

import (
	"encoding/json"
	"math/big"
	"os"
	"reflect"
	"strings"
	"testing"
)

func examples(t *testing.T) []struct {
	Name  string
	Input Input
	Plan  Plan
} {
	t.Helper()
	body, e := os.ReadFile("testdata/typescript-golden.json")
	if e != nil {
		t.Fatal(e)
	}
	var cases []struct {
		Name  string
		Input Input
		Plan  Plan
	}
	if e = json.Unmarshal(body, &cases); e != nil {
		t.Fatal(e)
	}
	return cases
}
func TestTypeScriptPlanningGolden(t *testing.T) {
	for _, example := range examples(t) {
		t.Run(example.Name, func(t *testing.T) {
			got, e := BuildPlan(example.Input)
			if e != nil || !reflect.DeepEqual(got, example.Plan) {
				t.Fatalf("plan mismatch: %+v %v, expected %+v", got, e, example.Plan)
			}
		})
	}
}
func TestPlanningRejectsInvalidInputAndUnboundQuotes(t *testing.T) {
	changes := map[string]func(*Input){
		"zero-chain": func(i *Input) { i.ChainID = 0 }, "unsafe-chain": func(i *Input) { i.ChainID = 1 << 53 }, "bad-market": func(i *Input) { i.MarketID = "0xAA" },
		"deadline-old": func(i *Input) { i.Deadline = i.Now - 1 }, "deadline-far": func(i *Input) { i.Deadline = i.Now + 301 }, "unsafe-time": func(i *Input) { i.Now = 1 << 53 },
		"slippage": func(i *Input) { i.SlippageBps = 101 }, "negative-slippage": func(i *Input) { i.SlippageBps = -1 },
		"zero-address": func(i *Input) { i.PendingParticipants[0].User = "0x" + strings.Repeat("0", 40) }, "bad-amount": func(i *Input) { i.PendingParticipants[0].MaximumMeme = "01" },
		"amount-overflow": func(i *Input) { i.PendingParticipants[0].MaximumMeme = new(big.Int).Lsh(big.NewInt(1), 256).String() },
		"duplicate":       func(i *Input) { i.PendingParticipants = append(i.PendingParticipants, i.PendingParticipants[0]) },
		"batch-cap":       func(i *Input) { i.PerBatchCap = "49" }, "total-cap": func(i *Input) { i.TotalMeme = "49" }, "item-cap": func(i *Input) { n := 1; i.Max32 = &n }, "invalid-item-cap": func(i *Input) { n := 33; i.Max32 = &n },
		"missing-participants": func(i *Input) { i.PendingParticipants = nil }, "missing-exits": func(i *Input) { i.RawExitAt = nil }, "invalid-exit": func(i *Input) { i.RawExitAt[i.PendingParticipants[0].User] = "-1" },
		"missing-quote": func(i *Input) { i.Quote = nil }, "old-quote": func(i *Input) { i.Quote.QuotedAt = i.Now - 31 }, "future-quote": func(i *Input) { i.Quote.QuotedAt = i.Now + 1 },
		"quote-chain": func(i *Input) { i.Quote.ChainID++ }, "quote-market": func(i *Input) { i.Quote.MarketID = "0x" + strings.Repeat("b", 64) }, "quote-digest": func(i *Input) { i.Quote.RequestDigest = "0x" + strings.Repeat("0", 64) },
		"reference": func(i *Input) { i.Quote.ReferenceID = " " }, "zero-output": func(i *Input) { i.Quote.ExpectedOutput = "0" }, "rounds-zero": func(i *Input) { i.Quote.ExpectedOutput = "1" },
		"reorder": func(i *Input) {
			i.PendingParticipants[0], i.PendingParticipants[1] = i.PendingParticipants[1], i.PendingParticipants[0]
		},
		"change-epoch": func(i *Input) { i.PendingParticipants[0].CreatorEpoch = 4 }, "change-amount": func(i *Input) { i.PendingParticipants[0].MaximumMeme = "20" },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			in := examples(t)[1].Input
			change(&in)
			if _, e := BuildPlan(in); e == nil {
				t.Fatal("accepted invalid candidate")
			}
		})
	}
}
func TestMatureExitExcludesAllRolesAndRebindsQuote(t *testing.T) {
	in := examples(t)[1].Input
	in.RawExitAt[in.PendingParticipants[0].User] = "1700000000"
	p, e := BuildPlan(in)
	if e != nil || len(p.Items) != 0 || len(p.Batches) != 0 || p.MinimumQuote != "0" || p.QuoteReferenceID != "" {
		t.Fatal(p, e)
	}
	in.PendingParticipants = append(in.PendingParticipants, in.PendingParticipants[0])
	if _, e = BuildPlan(in); e == nil {
		t.Fatal("duplicate skipped participants accepted")
	}
}
func TestRequestAndPlanDoNotAliasInput(t *testing.T) {
	in := examples(t)[1].Input
	p, e := BuildPlan(in)
	if e != nil {
		t.Fatal(e)
	}
	in.PendingParticipants[0].MaximumMeme = "999"
	if p.Items[0].MaximumMeme != "19" {
		t.Fatal("input aliases plan")
	}
	p.Items[0].MaximumMeme = "888"
	if p.Batches[0].Items[0].MaximumMeme != "19" {
		t.Fatal("batch aliases plan items")
	}
}

func TestExitChangeRequiresNewQuoteAndBatchNeverSplits(t *testing.T) {
	in := examples(t)[2].Input
	in.RawExitAt[in.PendingParticipants[0].User] = "0"
	if _, e := BuildPlan(in); e == nil {
		t.Fatal("changed selected items retained old quote")
	}
	in = examples(t)[4].Input
	in.PendingParticipants = append(in.PendingParticipants, Item{User: "0x0000000000000000000000000000000000000099", MaximumMeme: "1"})
	if _, e := BuildPlan(in); e == nil {
		t.Fatal("33 items split using one quote")
	}
}
