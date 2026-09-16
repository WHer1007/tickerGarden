package analytics

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
)

// Cancel deterministically at a checkpoint inside a large individual market,
// rather than relying on machine speed or a race against a timer.
type holderCancelContext struct {
	context.Context
	cancel   context.CancelFunc
	checks   int
	cancelAt int
}

func (c *holderCancelContext) Err() error {
	c.checks++
	if c.checks == c.cancelAt {
		c.cancel()
	}
	return c.Context.Err()
}
func TestGlobalHolderAggregationCancellation(t *testing.T) {
	inputs := globalHolderFixture()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	out, err := aggregateHolderSnapshots(ctx, "10", inputs[0].Holders.SourceBlockHash, inputs)
	if !errors.Is(err, context.Canceled) || !reflect.DeepEqual(out, GlobalHolderCounts{}) {
		t.Fatal(out, err)
	}
	// One market, 1024 sorted holders. The third context check occurs inside
	// this market, after entry and the market-level check.
	inputs = inputs[:1]
	h := &inputs[0].Holders
	h.ExcludedAccounts = []string{}
	h.TotalSupplyRaw = "1024"
	h.PositiveAddressCount = 1024
	h.IncludedAddressCount = 1024
	h.Balances = make([]HolderBalance, 1024)
	for i := range h.Balances {
		h.Balances[i] = HolderBalance{Account: fmt.Sprintf("0x%040x", i+1), BalanceRaw: "1"}
	}
	for _, cancelAt := range []int{3, 7, 11} {
		base, stop := context.WithCancel(context.Background())
		c := &holderCancelContext{base, stop, 0, cancelAt}
		out, err = aggregateHolderSnapshots(c, "10", h.SourceBlockHash, inputs)
		stop()
		if !errors.Is(err, context.Canceled) || !reflect.DeepEqual(out, GlobalHolderCounts{}) || c.checks != cancelAt {
			t.Fatal(cancelAt, c.checks, out, err)
		}
	}
	got, err := aggregateHolderSnapshots(context.Background(), "10", h.SourceBlockHash, inputs)
	if err != nil || got.PositiveAddressCount != 1024 || got.IncludedAddressCount != 1024 {
		t.Fatal(got, err)
	}
}
