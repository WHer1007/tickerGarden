package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"tickergarden/backend/internal/readmodel"
)

type fixtureReader struct{ snapshot readmodel.Snapshot }

func (f fixtureReader) Load(context.Context, string) (readmodel.Snapshot, error) {
	return f.snapshot, nil
}

func TestReadEndpointsFixtureAndGuards(t *testing.T) {
	b, err := os.ReadFile("../readmodel/testdata/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := readmodel.Parse(b, 46630)
	if err != nil {
		t.Fatal(err)
	}
	h := New(Options{ChainID: 46630, ReadModels: fixtureReader{s}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	market := s.Markets[0].MarketID
	user := s.Positions[0].User
	paths := []string{"/health", "/v1/markets", "/v1/markets/" + market, "/v1/config/asset", "/v1/users/" + user + "/positions"}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, path, nil)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 200 {
				t.Fatalf("status %d: %s", w.Code, w.Body)
			}
			if !json.Valid(w.Body.Bytes()) {
				t.Fatal("invalid JSON")
			}
		})
	}
	for _, tc := range []struct {
		method, path string
		code         int
	}{{"POST", "/v1/markets", 405}, {"GET", "/v1/markets?limit=0", 400}, {"GET", "/v1/markets?assetUid=0xBAD", 400}, {"GET", "/v1/markets/0x000000000000000000000000000000000000000000000000000000000000ffff", 404}} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != tc.code {
			t.Errorf("%s %s: got %d want %d", tc.method, tc.path, w.Code, tc.code)
		}
	}
	if err := readmodel.ValidateResponse("MarketReadModel", mustJSON(s.Markets[0])); err != nil {
		t.Fatal(err)
	}
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
