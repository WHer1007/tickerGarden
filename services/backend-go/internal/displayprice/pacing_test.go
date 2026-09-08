package displayprice

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestQuotePacingAndCancellation(t *testing.T) {
	b := &batch{}
	started := time.Now()
	for i := 0; i < 3; i++ {
		if err := b.waitQuote(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if time.Since(started) < 200*time.Millisecond {
		t.Fatal("quote starts were not spaced")
	}
	b.nextQuote = time.Now().Add(time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := b.waitQuote(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel did not stop waiting: %v", err)
	}
	next := &batch{}
	if err := next.waitQuote(context.Background()); err != nil {
		t.Fatal(err)
	}
}
