package analytics

import (
	"fmt"
	"testing"
)

func TestGlobalFlowSeriesBoundariesAndEmptyBuckets(t *testing.T) {
	coverage, inputs := assetStatsFixture()
	coverage.To = 300
	for i := range inputs {
		inputs[i].Trades.Coverage = coverage
		inputs[i].Trades.Items[0].Timestamp = fmt.Sprint(60 + i*60)
	}
	out, err := BuildGlobalFlowSeries(4663, coverage, 60, inputs)
	if err != nil || len(out.Points) != 4 || out.Coverage != coverage {
		t.Fatal(out, err)
	}
	expected := []string{"2000000", "4000000", "1000000", "0"}
	for i, p := range out.Points {
		if p.Timestamp != uint64(60+i*60) || len(p.Groups) != 1 || p.Groups[0].QuoteVolumeRaw != expected[i] {
			t.Fatal(p)
		}
	}
	internal := out.Points[1].Groups[0]
	if internal.InternalTradeCount != 1 || internal.InternalQuoteVolumeRaw != "4000000" || internal.UnknownFeeTradeCount != 1 {
		t.Fatal(internal)
	}
	empty := out.Points[3].Groups[0]
	if empty.TradeCount != 0 || empty.InternalQuoteVolumeRaw != "0" || len(empty.Fees) != 0 {
		t.Fatal(empty)
	}
	if inputs[0].Trades.Coverage != coverage || len(inputs[0].Trades.Items) != 1 {
		t.Fatal("mutated original input")
	}
	// Whole-range duplicate detection precedes partitioning.
	inputs[1].Trades.Items[0].Source = inputs[0].Trades.Items[0].Source
	if _, err := BuildGlobalFlowSeries(4663, coverage, 60, inputs); err == nil {
		t.Fatal("cross-bucket duplicate accepted")
	}
}
func TestGlobalFlowSeriesRejectRangeAndEndBoundary(t *testing.T) {
	c, in := assetStatsFixture()
	for _, interval := range []uint64{0, 1, 3600} {
		if _, err := BuildGlobalFlowSeries(4663, c, interval, in); err == nil {
			t.Fatal(interval)
		}
	}
	in[0].Trades.Items[0].Timestamp = "120"
	if _, err := BuildGlobalFlowSeries(4663, c, 60, in); err == nil {
		t.Fatal("end boundary counted")
	}
	empty, err := BuildGlobalFlowSeries(4663, c, 60, nil)
	if err != nil || len(empty.Points) != 1 || empty.Points[0].Groups == nil || len(empty.Points[0].Groups) != 0 {
		t.Fatal(empty, err)
	}
}
