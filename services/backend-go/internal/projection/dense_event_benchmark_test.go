package projection

import (
	"fmt"
	"strings"
	"testing"

	"tickergarden/backend/internal/events"
)

// BenchmarkProjectionDenseTrades is a synthetic CPU-only baseline. It excludes
// RPC, database, network, and durable checkpoint costs; it measures ordered
// semantic projection of bounded, valid trade events only.
func BenchmarkProjectionDenseTrades(b *testing.B) {
	fixtures := fixtureInputs(b)
	setup := make([]Input, 0, len(fixtures))
	trades := make([]Input, 0, 4)
	markets := map[string]struct{}{}
	for _, input := range fixtures {
		decoded, err := events.Decode(input.Module, input.Log)
		if err != nil {
			b.Fatal(err)
		}
		if strings.HasPrefix(decoded.Signature, "Swap(") {
			trades = append(trades, input)
			if len(input.Log.Topics) > 1 {
				markets[input.Log.Topics[1]] = struct{}{}
			}
		}
		setup = append(setup, input)
	}
	if len(trades) < 2 || len(markets) == 0 {
		b.Fatalf("fixture needs repeated trade events: trades=%d markets=%d", len(trades), len(markets))
	}

	b.ResetTimer()
	for round := 0; round < b.N; round++ {
		s := New()
		for _, input := range setup {
			if _, err := s.Apply(input); err != nil {
				b.Fatal(err)
			}
		}
		for i, input := range trades {
			input.Log.BlockNumber = fmt.Sprintf("0x%x", 0xb+round)
			input.Log.BlockHash = fmt.Sprintf("0x%064x", 0x1000+round)
			input.Log.TransactionHash = fmt.Sprintf("0x%064x", 0x2000+round*len(trades)+i)
			input.Log.TransactionIndex = "0x0"
			input.Log.LogIndex = fmt.Sprintf("0x%x", i)
			if status, err := s.Apply(input); err != nil || status != "applied" {
				b.Fatalf("trade %d apply: status=%q err=%v", i, status, err)
			}
		}
		if got := len(s.tables["swaps"]); got < len(trades)*2 {
			b.Fatalf("swap table rows=%d, want at least %d", got, len(trades)*2)
		}
	}
	b.ReportMetric(float64(len(setup)), "events/setup")
	b.ReportMetric(float64(len(markets)), "markets/trade")
	b.ReportMetric(float64(len(trades)), "events/trade-round")

}
