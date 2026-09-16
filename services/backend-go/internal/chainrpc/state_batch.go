package chainrpc

import (
	"context"
	"errors"
	"golang.org/x/sync/errgroup"
)

type StateCall struct {
	Address string
	Data    string
}

// CodesAt and CallsAt bound parallel independent reads to four requests. Every
// read retains the same EIP-1898 requireCanonical hash; partial results never
// escape. Callers still recheck the canonical header after validating results.
func (c *Client) CodesAt(ctx context.Context, addresses []string, hash string) ([][]byte, error) {
	if len(addresses) == 0 || len(addresses) > 256 || !hashPattern.MatchString(hash) {
		return nil, errors.New("invalid code batch")
	}
	out := make([][]byte, len(addresses))
	g, child := errgroup.WithContext(ctx)
	g.SetLimit(4)
	for i, a := range addresses {
		g.Go(func() error { var e error; out[i], e = c.CodeAt(child, a, hash); return e })
	}
	if e := g.Wait(); e != nil {
		return nil, e
	}
	return out, nil
}
func (c *Client) CallsAt(ctx context.Context, calls []StateCall, hash string) ([][]byte, error) {
	if len(calls) == 0 || len(calls) > 256 || !hashPattern.MatchString(hash) {
		return nil, errors.New("invalid call batch")
	}
	out := make([][]byte, len(calls))
	g, child := errgroup.WithContext(ctx)
	g.SetLimit(4)
	for i, call := range calls {
		g.Go(func() error { var e error; out[i], e = c.CallAt(child, call.Address, call.Data, hash); return e })
	}
	if e := g.Wait(); e != nil {
		return nil, e
	}
	return out, nil
}
