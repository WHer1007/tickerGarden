package httpapi

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/analytics"
)

type globalHolderFixture struct {
	calls int
	err   error
	bad   bool
}

func (f *globalHolderFixture) GlobalHolders(ctx context.Context) (analytics.GlobalHolderCounts, error) {
	f.calls++
	if _, ok := ctx.Deadline(); !ok {
		panic("missing deadline")
	}
	out := analytics.GlobalHolderCounts{SourceBlockNumber: "1", SourceBlockHash: "0x" + strings.Repeat("1", 64), ExclusionPolicy: "UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1", ExcludedAccounts: []string{}, Groups: []analytics.AssetHolderCounts{}}
	if f.bad {
		out.IncludedAddressCount = 1
	}
	return out, f.err
}
func TestGlobalHolderHTTP(t *testing.T) {
	f := &globalHolderFixture{}
	h := New(Options{GlobalHolders: f})
	path := "/v1/stats/holders"
	for _, q := range []string{"?from=1", "?limit=1", "?%zz", "?a=1&a=1"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code)
		}
	}
	if f.calls != 0 {
		t.Fatal("query reached reader")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Code)
	}
	f.err = errors.New("private failure")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 503 || strings.Contains(w.Body.String(), "private") {
		t.Fatal(w.Code, w.Body.String())
	}
	f.err = nil
	f.bad = true
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 503 {
		t.Fatal("inconsistent counts accepted")
	}
	w = httptest.NewRecorder()
	New(Options{}).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", path, nil))
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
}
