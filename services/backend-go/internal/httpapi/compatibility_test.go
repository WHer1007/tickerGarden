package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/readmodel"
)

type readerFunc func(context.Context, string) (readmodel.Snapshot, error)

func (f readerFunc) Load(c context.Context, r string) (readmodel.Snapshot, error) { return f(c, r) }
func testSnapshot(t *testing.T) readmodel.Snapshot {
	t.Helper()
	b, e := os.ReadFile("../readmodel/testdata/snapshot.json")
	if e != nil {
		t.Fatal(e)
	}
	s, e := readmodel.Parse(b, 46630)
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestResponsesMatchTypeScriptGolden(t *testing.T) {
	s := testSnapshot(t)
	raw, e := os.ReadFile("../readmodel/testdata/api-golden.json")
	if e != nil {
		t.Fatal(e)
	}
	checkGolden(t, s, raw)
}
func TestIdentityResponsesMatchTypeScriptGolden(t *testing.T) {
	raw, e := os.ReadFile("../readmodel/testdata/identity-api-golden.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Snapshot json.RawMessage
		Cases    json.RawMessage
	}
	if e = json.Unmarshal(raw, &fixture); e != nil {
		t.Fatal(e)
	}
	s, e := readmodel.Parse(fixture.Snapshot, 46630)
	if e != nil {
		t.Fatal(e)
	}
	checkGolden(t, s, fixture.Cases)
}
func checkGolden(t *testing.T, s readmodel.Snapshot, raw []byte) {
	t.Helper()
	handler := New(Options{ChainID: 46630, ReadModels: fixtureReader{s}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	var cases []struct {
		Path   string
		Status int
		Body   json.RawMessage
	}
	if e := json.Unmarshal(raw, &cases); e != nil {
		t.Fatal(e)
	}
	normalize := func(b []byte) any {
		d := json.NewDecoder(bytes.NewReader(b))
		d.UseNumber()
		var v any
		if e := d.Decode(&v); e != nil {
			t.Fatal(e)
		}
		return v
	}
	for _, tc := range cases {
		t.Run(tc.Path, func(t *testing.T) {
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, httptest.NewRequest("GET", tc.Path, nil))
			if w.Code != tc.Status || !reflect.DeepEqual(normalize(w.Body.Bytes()), normalize(tc.Body)) {
				t.Fatalf("Go/TypeScript mismatch: %s", w.Body.String())
			}
			schema := "MarketPage"
			switch {
			case tc.Status >= 400:
				schema = "ApiErrorResponse"
			case tc.Path == "/health":
				schema = "HealthResponse"
			case strings.HasPrefix(tc.Path, "/v1/config/"):
				schema = "ConfigPage"
			case strings.HasPrefix(tc.Path, "/v1/users/"):
				schema = "PositionPage"
			case strings.HasPrefix(tc.Path, "/v1/markets/"):
				schema = "MarketDetailResponse"
			}
			if e := readmodel.ValidateResponse(schema, w.Body.Bytes()); e != nil {
				t.Fatal(e)
			}
		})
	}
}
func TestPinnedPagingAndUnavailableGuard(t *testing.T) {
	old := testSnapshot(t)
	current := old
	current.Sync.Revision = "2:0x" + strings.Repeat("a", 64)
	handler := New(Options{ChainID: 46630, ReadModels: readerFunc(func(_ context.Context, rev string) (readmodel.Snapshot, error) {
		if rev == old.Sync.Revision {
			return old, nil
		}
		if rev != "" && rev != current.Sync.Revision {
			return readmodel.Empty(46630), readmodel.ErrRevision
		}
		return current, nil
	}), Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	get := func(path string, want int) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != want {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
		return w
	}
	first := get("/v1/markets?limit=1&revision="+old.Sync.Revision, 200)
	var p page[readmodel.MarketReadModel]
	if e := json.Unmarshal(first.Body.Bytes(), &p); e != nil || p.NextCursor == nil {
		t.Fatal("no pagination cursor", e)
	}
	get("/v1/markets?limit=1&cursor="+*p.NextCursor, 400)
	second := get("/v1/markets?limit=1&revision="+old.Sync.Revision+"&cursor="+*p.NextCursor, 200)
	if strings.Contains(second.Body.String(), old.Markets[0].MarketID) {
		t.Fatal("second page repeated first market")
	}
	get("/v1/config/asset?revision="+old.Sync.Revision+"&cursor="+*p.NextCursor, 400)
	get("/v1/markets?assetUid="+old.Markets[0].AssetUID+"&revision="+old.Sync.Revision+"&cursor="+*p.NextCursor, 400)
	get("/v1/markets?revision=3:0x"+strings.Repeat("b", 64), 400)
	for _, path := range []string{"/v1/markets?limit=101", "/v1/markets?limit=1&limit=2", "/v1/markets?revision=", "/v1/markets?cursor=garbage"} {
		get(path, 400)
	}
	failed := New(Options{ChainID: 46630, ReadModels: readerFunc(func(context.Context, string) (readmodel.Snapshot, error) {
		return readmodel.Snapshot{}, errors.New("postgres://secret")
	}), Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	w := httptest.NewRecorder()
	failed.ServeHTTP(w, httptest.NewRequest("GET", "/v1/markets", nil))
	if strings.Contains(w.Body.String(), "secret") || !strings.Contains(w.Body.String(), `"status":"unavailable"`) {
		t.Fatal("failed storage leaked or advertised availability")
	}
}
