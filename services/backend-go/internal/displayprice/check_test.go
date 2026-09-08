package displayprice

import (
	"context"
	"testing"
)

func TestCheckAvailability(t *testing.T) {
	for _, mode := range []string{"", "stale", "deployment", "action"} {
		t.Run(mode, func(t *testing.T) {
			p, target, _ := priceFixture(t, mode)
			s, err := New([]Target{target}, target.ChainID, p)
			if err != nil {
				t.Fatal(err)
			}
			result := s.Check(context.Background())
			if !result.DisplayOnly || result.CheckedAt.IsZero() || len(result.References) != 1 || result.AllAvailable != (mode == "") {
				t.Fatalf("unexpected result: %+v", result)
			}
			if mode != "" && (result.References[0].BidUSD != nil || result.References[0].AskUSD != nil) {
				t.Fatal("unavailable price leaked")
			}
		})
	}
}

func TestCancelledCheckCannotPass(t *testing.T) {
	p, target, _ := priceFixture(t, "")
	s, err := New([]Target{target}, target.ChainID, p)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if s.Check(ctx).AllAvailable {
		t.Fatal("cancelled check passed")
	}
}
