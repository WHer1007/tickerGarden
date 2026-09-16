package httpapi

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/useractivity"
)

type activityFixture struct {
	calls   int
	account string
	limit   int
	cursor  string
	err     error
	page    useractivity.Page
}

func (f *activityFixture) Load(ctx context.Context, account string, limit int, cursor string) (useractivity.Page, error) {
	f.calls++
	if _, ok := ctx.Deadline(); !ok {
		panic("missing deadline")
	}
	f.account, f.limit, f.cursor = account, limit, cursor
	return f.page, f.err
}

func validActivityPage(account string) useractivity.Page {
	return useractivity.Page{
		ChainID: 4663, Account: account, Items: []useractivity.Record{}, NextCursor: nil,
		IndexedFrom: "0", SourceBlockNumber: "0", SourceBlockHash: "0x" + strings.Repeat("0", 64),
		Revision: "sha256:" + strings.Repeat("0", 64), Finality: "finalized", ObservedAt: time.Now().UTC(), DisplayOnly: true,
	}
}

func TestUserActivityHTTP(t *testing.T) {
	account := "0x" + strings.Repeat("1", 40)
	f := &activityFixture{page: validActivityPage(account)}
	h := New(Options{Activities: f, ChainID: 4663})

	for _, suffix := range []string{"?foo=1", "?limit=2&limit=3", "?%zz", "?limit=0", "?limit=101", "?cursor=", "?cursor=" + strings.Repeat("x", 1025)} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/users/"+account+"/activity"+suffix, nil))
		if w.Code != 400 {
			t.Fatalf("query %q: status %d", suffix, w.Code)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/users/0x"+strings.Repeat("0", 40)+"/activity", nil))
	if w.Code != 400 || f.calls != 0 {
		t.Fatalf("zero address: status=%d calls=%d", w.Code, f.calls)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/users/not-an-address/activity", nil))
	if w.Code != 400 || f.calls != 0 {
		t.Fatalf("unknown address: status=%d calls=%d", w.Code, f.calls)
	}

	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/users/"+account+"/activity?limit=7&cursor=abc", nil))
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || f.calls != 1 || f.account != account || f.limit != 7 || f.cursor != "abc" {
		t.Fatalf("valid request: status=%d calls=%d body=%s args=%s/%d/%s", w.Code, f.calls, w.Body.String(), f.account, f.limit, f.cursor)
	}

	for _, tc := range []struct {
		name string
		err  error
		code int
	}{
		{"cursor", useractivity.ErrCursor, 400},
		{"revision", useractivity.ErrRevision, 409},
		{"private service", errors.New("private service failure"), 503},
	} {
		f.err = tc.err
		w = httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/users/"+account+"/activity", nil))
		if w.Code != tc.code || strings.Contains(w.Body.String(), "private service") {
			t.Fatalf("%s: status=%d body=%s", tc.name, w.Code, w.Body.String())
		}
	}
	f.err = nil

	for _, tc := range []struct {
		name string
		page useractivity.Page
	}{
		{"chain", func() useractivity.Page { p := validActivityPage(account); p.ChainID = 46630; return p }()},
		{"account", func() useractivity.Page {
			p := validActivityPage(account)
			p.Account = "0x" + strings.Repeat("2", 40)
			return p
		}()},
		{"displayOnly", func() useractivity.Page { p := validActivityPage(account); p.DisplayOnly = false; return p }()},
	} {
		f.page = tc.page
		w = httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/users/"+account+"/activity", nil))
		if w.Code != 503 || strings.Contains(w.Body.String(), "private") {
			t.Fatalf("%s: status=%d body=%s", tc.name, w.Code, w.Body.String())
		}
	}

	w = httptest.NewRecorder()
	New(Options{ChainID: 4663}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/users/"+account+"/activity", nil))
	if w.Code != 503 {
		t.Fatalf("unconfigured: status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/users/"+account+"/activity", nil))
	if w.Code != 405 {
		t.Fatalf("POST: status=%d", w.Code)
	}
}
