package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"tickergarden/backend/internal/analytics"
)

type assetStatisticsFixture struct {
	calls    int
	err      error
	mismatch bool
}

func (f *assetStatisticsFixture) AssetStatistics(ctx context.Context, asset string, from, to uint64) (analytics.AssetStatistics, error) {
	f.calls++
	if _, ok := ctx.Deadline(); !ok {
		panic("missing request timeout")
	}
	if f.mismatch {
		to++
	}
	return analytics.AssetStatistics{AssetUID: asset, StockToken: "0x" + strings.Repeat("2", 40), StockDecimals: 8, Coverage: analytics.RangeCoverage{From: from, To: to}, Groups: []analytics.AssetTradeStats{}}, f.err
}
func TestAssetStatisticsHTTP(t *testing.T) {
	f := &assetStatisticsFixture{}
	h := New(Options{ChainID: 4663, AssetStatistics: f})
	path := "/v1/assets/0x" + strings.Repeat("1", 64) + "/statistics"
	for _, q := range []string{"", "?from=01&to=2", "?from=2&to=2", "?from=3&to=2", "?from=1&to=2&from=1", "?from=1&to=2&limit=1", "?from=-1&to=2", "?from=1&to=9223372036854775808", "?from=1&to=%zz"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path+q, nil))
		if w.Code != 400 {
			t.Fatal(q, w.Code)
		}
	}
	if f.calls != 0 {
		t.Fatal("invalid query reached store")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path+"?from=1&to=2", nil))
	var got struct {
		ChainID     uint64 `json:"chainId"`
		DisplayOnly bool   `json:"displayOnly"`
		analytics.AssetStatistics
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &got) != nil || got.ChainID != 4663 || !got.DisplayOnly || got.Groups == nil || got.AssetUID != "0x"+strings.Repeat("1", 64) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Code, w.Body.String())
	}
	f.err = errors.New("private database error")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path+"?from=1&to=2", nil))
	if w.Code != 503 || strings.Contains(w.Body.String(), "private") {
		t.Fatal(w.Code, w.Body.String())
	}
	f.err = nil
	f.mismatch = true
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path+"?from=1&to=2", nil))
	if w.Code != 503 {
		t.Fatal("mismatched coverage accepted")
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", path+"?from=1&to=2", nil))
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	New(Options{}).ServeHTTP(w, httptest.NewRequest("GET", path+"?from=1&to=2", nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}
