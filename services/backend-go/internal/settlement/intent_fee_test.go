package settlement

import (
	"math"
	"math/big"
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
)

func validExecutionPreview(t *testing.T) ConversionPreview {
	t.Helper()
	market := "0x" + strings.Repeat("a", 64)
	op := "0x" + strings.Repeat("1", 40)
	vault := "0x" + strings.Repeat("2", 40)
	b := Batch{MarketID: market, Items: []Item{{User: "0x" + strings.Repeat("3", 40), CreatorEpoch: 1, MaximumMeme: "10"}}, MinimumQuote: "1", Deadline: 100}
	data, err := conversionData(b)
	if err != nil {
		t.Fatal(err)
	}
	return ConversionPreview{Candidate: ObservedCandidate{State: deployment.RewardConversionState{Operator: op, FeeVault: vault}, Plan: &Plan{Batches: []Batch{b}}}, From: op, To: vault, Data: data, Value: "0x0"}
}

func TestExecutionCallCanonicalFeesAndCost(t *testing.T) {
	p := validExecutionPreview(t)
	call, cost, err := executionCall(p, 7, ExecutionPolicy{GasLimit: "21000", MaxFeePerGas: "2", MaxPriorityFeePerGas: "1", MaximumGasCost: "42000"})
	if err != nil || cost != "42000" || call.From != p.From || call.To != p.To || call.Data != p.Data || call.Value != "0x0" || call.Gas != "0x5208" || call.Nonce != "0x7" || call.MaxFeePerGas != "0x2" || call.MaxPriorityFeePerGas != "0x1" {
		t.Fatalf("bad call: %#v %s %v", call, cost, err)
	}

	cases := map[string]func(*ConversionPreview, *ExecutionPolicy, *uint64){
		"decimal gas":      func(_ *ConversionPreview, f *ExecutionPolicy, _ *uint64) { f.GasLimit = "021000" },
		"gas low":          func(_ *ConversionPreview, f *ExecutionPolicy, _ *uint64) { f.GasLimit = "20999" },
		"gas high":         func(_ *ConversionPreview, f *ExecutionPolicy, _ *uint64) { f.GasLimit = "9223372036854775808" },
		"zero fee":         func(_ *ConversionPreview, f *ExecutionPolicy, _ *uint64) { f.MaxFeePerGas = "0" },
		"priority exceeds": func(_ *ConversionPreview, f *ExecutionPolicy, _ *uint64) { f.MaxPriorityFeePerGas = "3" },
		"cost cap":         func(_ *ConversionPreview, f *ExecutionPolicy, _ *uint64) { f.MaximumGasCost = "41999" },
		"fee overflow": func(_ *ConversionPreview, f *ExecutionPolicy, _ *uint64) {
			f.MaxFeePerGas = "" + strings.Repeat("9", 78)
		},
		"cost multiplication overflow": func(_ *ConversionPreview, f *ExecutionPolicy, _ *uint64) {
			f.GasLimit = "9223372036854775807"
			f.MaxFeePerGas = new(big.Int).Lsh(big.NewInt(1), 255).String()
			f.MaximumGasCost = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)).String()
		},
		"nonce max":       func(_ *ConversionPreview, _ *ExecutionPolicy, n *uint64) { *n = math.MaxInt64 },
		"data mismatch":   func(p *ConversionPreview, _ *ExecutionPolicy, _ *uint64) { p.Data += "00" },
		"target mismatch": func(p *ConversionPreview, _ *ExecutionPolicy, _ *uint64) { p.To = "0x" + strings.Repeat("4", 40) },
		"from mismatch":   func(p *ConversionPreview, _ *ExecutionPolicy, _ *uint64) { p.From = "0x" + strings.Repeat("4", 40) },
		"value mismatch":  func(p *ConversionPreview, _ *ExecutionPolicy, _ *uint64) { p.Value = "0x1" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			q, f, n := validExecutionPreview(t), ExecutionPolicy{GasLimit: "21000", MaxFeePerGas: "2", MaxPriorityFeePerGas: "1", MaximumGasCost: "42000"}, uint64(7)
			mutate(&q, &f, &n)
			if _, _, err := executionCall(q, n, f); err == nil {
				t.Fatal("invalid execution call accepted")
			}
		})
	}
}
