package displayprice

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestUpstreamFailureReasons(t *testing.T) {
	for _, tc := range []struct {
		status       int
		body, reason string
	}{
		{429, "secret", "rate_limited"}, {404, "secret", "not_found"}, {403, "secret", "access_denied"}, {503, "secret", "server_error"}, {302, "secret", "http_error"}, {200, "not json", "invalid_json"}, {200, strings.Repeat(" ", (2<<20)+1), "response_too_large"},
	} {
		p, target, now := priceFixture(t, "")
		p.Client.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
		})
		result := p.Fetch(context.Background(), target, now)
		if result.Reason != "assets_"+tc.reason || result.BidUSD != nil || result.Status != "unavailable" {
			t.Fatalf("unexpected result: %+v", result)
		}
	}
}
func TestRequestFailureCategories(t *testing.T) {
	deadline, stop := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer stop()
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tc := range []struct {
		ctx  context.Context
		err  error
		want string
	}{
		{deadline, os.ErrDeadlineExceeded, "prices_budget_exhausted"},
		{cancelled, context.Canceled, "prices_cancelled"},
		{context.Background(), os.ErrDeadlineExceeded, "prices_timeout"},
		{context.Background(), errors.New("private proxy address"), "prices_transport_error"},
	} {
		if got := failureReason("prices", requestFailure(tc.ctx, tc.err)); got != tc.want {
			t.Fatalf("got %s want %s", got, tc.want)
		}
	}
}
