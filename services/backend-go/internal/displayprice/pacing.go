package displayprice

import (
	"context"
	"time"
)

// Pace quote starts as well as limiting concurrent work. Reservation is local
// to the refresh; cancellation cannot leave a queue for subsequent rounds.
func (b *batch) waitQuote(ctx context.Context) error {
	b.quoteMu.Lock()
	now := time.Now()
	start := b.nextQuote
	if start.Before(now) {
		start = now
	}
	b.nextQuote = start.Add(100 * time.Millisecond)
	b.quoteMu.Unlock()
	timer := time.NewTimer(time.Until(start))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return ctx.Err()
	}
}
