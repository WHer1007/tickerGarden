package analytics

import (
	"errors"
	"fmt"
	"testing"
)

func TestTradePaginationBindingsAndChanges(t *testing.T) {
	data := MarketTrades{MarketID: "market", Coverage: RangeCoverage{From: 60, To: 120}, Items: []TradeActivity{}}
	for i := 0; i < 205; i++ {
		data.Items = append(data.Items, TradeActivity{Source: CurveSource{EventKey: fmt.Sprint(i)}})
	}
	first, e := PageTrades(4663, data, 100, "")
	if e != nil || len(first.Items) != 100 || first.NextCursor == nil {
		t.Fatal(first, e)
	}
	second, e := PageTrades(4663, data, 100, *first.NextCursor)
	if e != nil || len(second.Items) != 100 || second.Items[0].Source.EventKey != "100" {
		t.Fatal(second, e)
	}
	third, e := PageTrades(4663, data, 100, *second.NextCursor)
	if e != nil || len(third.Items) != 5 || third.NextCursor != nil {
		t.Fatal(third, e)
	}
	for _, mode := range []string{"chain", "limit", "market", "range", "cursor", "changed"} {
		t.Run(mode, func(t *testing.T) {
			copy := data
			chain := uint64(4663)
			limit := 100
			cursor := *first.NextCursor
			want := ErrTradeCursor
			switch mode {
			case "chain":
				chain = 1
			case "limit":
				limit = 50
			case "market":
				copy.MarketID = "other"
			case "range":
				copy.Coverage.To++
			case "cursor":
				cursor += "="
			case "changed":
				copy.Coverage.ProjectionNumber++
				want = ErrTradePageChanged
			}
			if _, e := PageTrades(chain, copy, limit, cursor); !errors.Is(e, want) {
				t.Fatal(e)
			}
		})
	}
	empty, e := PageTrades(4663, MarketTrades{Items: []TradeActivity{}}, 100, "")
	if e != nil || empty.Items == nil || empty.NextCursor != nil {
		t.Fatal(empty, e)
	}
}
