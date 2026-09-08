package httpapi

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/tokendetail"
)

type detailStub struct{ calls int }

func (s *detailStub) Detail(_ context.Context, id, p string) (tokendetail.Report, error) {
	s.calls++
	return tokendetail.Report{Version: 1, ChainID: 46630, DisplayOnly: true, MarketID: id, Period: p}, nil
}
func TestTokenDetailReadonlyRoute(t *testing.T) {
	s := &detailStub{}
	h := New(Options{ChainID: 46630, TokenDetail: s})
	path := "/v1/markets/0x" + strings.Repeat("a", 64) + "/detail"
	for _, c := range []struct {
		method, path string
		code         int
	}{{"GET", path + "?period=1H", 200}, {"GET", path + "?period=12H", 200}, {"GET", path + "?period=1D", 200}, {"GET", path + "?period=6H", 400}, {"GET", path + "?period=2H", 400}, {"GET", path + "?period=1H&period=1D", 400}, {"GET", path + "?api_key=secret", 400}, {"POST", path, 405}, {"GET", "/v1/markets/wrong/detail", 400}} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(c.method, c.path, nil))
		if w.Code != c.code {
			t.Fatalf("%s %s got %d want %d", c.method, c.path, w.Code, c.code)
		}
		if c.code == 200 {
			var v tokendetail.Report
			if json.Unmarshal(w.Body.Bytes(), &v) != nil || !v.DisplayOnly || v.MarketID == "" {
				t.Fatal("bad response", w.Body.String())
			}
		}
	}
	if s.calls != 3 {
		t.Fatalf("invalid requests reached reader: %d", s.calls)
	}
	w := httptest.NewRecorder()
	New(Options{ChainID: 46630}).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 503 {
		t.Fatal("missing reader must not invent zero", w.Code)
	}
}
