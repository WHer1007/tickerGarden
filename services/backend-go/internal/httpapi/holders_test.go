package httpapi

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/analytics"
)

type holderFixture struct {
	err   error
	calls int
}

func (f *holderFixture) HolderPage(ctx context.Context, m string, limit int, cursor string) (analytics.HolderPage, error) {
	f.calls++
	if _, ok := ctx.Deadline(); !ok {
		panic("missing timeout")
	}
	return analytics.HolderPage{MarketHolders: analytics.MarketHolders{MarketID: m, Finality: "finalized", HolderBalances: analytics.HolderBalances{Balances: []analytics.HolderBalance{}}}}, f.err
}
func TestHolderHTTP(t *testing.T) {
	f := &holderFixture{}
	h := New(Options{Holders: f, ChainID: 4663})
	path := "/v1/markets/0x" + strings.Repeat("1", 64) + "/holders"
	for _, q := range []string{"?limit=0", "?limit=101", "?limit=01", "?cursor=", "?limit=1&limit=1", "?from=0", "?limit=%zz"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code)
		}
	}
	if f.calls != 0 {
		t.Fatal("invalid query reached reader")
	}
	for _, tc := range []struct {
		e      error
		status int
	}{{nil, 200}, {analytics.ErrHolderCursor, 400}, {analytics.ErrHolderPageChanged, 409}, {errors.New("private database error"), 503}} {
		f.err = tc.e
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" || strings.Contains(w.Body.String(), "private") {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", path, nil))
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	New(Options{}).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}
