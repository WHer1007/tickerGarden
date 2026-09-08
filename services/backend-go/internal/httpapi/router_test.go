package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type pingFunc func(context.Context) error

func (f pingFunc) Ping(ctx context.Context) error { return f(ctx) }

func TestReadinessNeverConfusesDatabaseWithChainReadiness(t *testing.T) {
	for _, tc := range []struct {
		name string
		db   Pinger
		want string
	}{
		{"no database", nil, "not_configured"},
		{"reachable database", pingFunc(func(context.Context) error { return nil }), "reachable"},
		{"failed database", pingFunc(func(context.Context) error { return errors.New("password=must-not-leak") }), "unavailable"},
		{"timed out database", pingFunc(func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }), "unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handler := New(Options{Database: tc.db, ChainID: 46630, ProbeTimeout: time.Millisecond, Logger: slog.New(slog.NewJSONHandler(io.Discard, nil))})
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
			var body struct {
				Status string
				Checks map[string]string
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != 503 || body.Checks["database"] != tc.want || body.Checks["read_model"] != "unavailable" {
				t.Fatalf("unexpected readiness: %d %s", response.Code, response.Body)
			}
			if strings.Contains(response.Body.String(), "must-not-leak") {
				t.Fatal("database error leaked")
			}
		})
	}
}

func TestRoutesFailClosedAndRemainLive(t *testing.T) {
	handler := New(Options{ChainID: 46630, Logger: slog.New(slog.NewJSONHandler(io.Discard, nil))})
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/livez", 200}, {"GET", "/health", 200},
		{"GET", "/v1/markets", 200}, {"GET", "/v1", 404},
		{"POST", "/v1/markets", 405}, {"DELETE", "/v1/users/user/positions", 405},
		{"POST", "/health", 405}, {"GET", "/missing", 404},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, nil))
			if response.Code != tc.status {
				t.Fatalf("got %d want %d", response.Code, tc.status)
			}
			if response.Header().Get("X-Request-ID") == "" {
				t.Fatal("missing request id")
			}
			if !json.Valid(response.Body.Bytes()) {
				t.Fatal("expected JSON envelope")
			}
		})
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/health", nil))
	var health struct {
		ReadAPIImplemented    bool
		TransactionSubmission bool
		Status                string
		Sync                  struct{ Status string }
	}
	if err := json.Unmarshal(response.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	if !health.ReadAPIImplemented || health.TransactionSubmission || health.Status != "read-api" || health.Sync.Status != "unavailable" {
		t.Fatal("health overstated scaffold capabilities")
	}
}

func TestCORSOnlyAllowsConfiguredOriginAndReadPreflight(t *testing.T) {
	handler := New(Options{AllowedOrigin: "https://garden.example", Logger: slog.New(slog.NewJSONHandler(io.Discard, nil))})
	for _, tc := range []struct {
		origin, method, preflight string
		status                    int
		allowed                   bool
	}{
		{"https://garden.example", "GET", "", 200, true},
		{"https://garden.example.evil", "GET", "", 403, false},
		{"null", "GET", "", 403, false},
		{"", "GET", "", 200, false},
		{"https://garden.example", "OPTIONS", "GET", 204, true},
		{"https://garden.example", "OPTIONS", "POST", 405, true},
		{"", "OPTIONS", "GET", 405, false},
	} {
		request := httptest.NewRequest(tc.method, "/health", nil)
		request.Header.Set("Origin", tc.origin)
		request.Header.Set("Access-Control-Request-Method", tc.preflight)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != tc.status {
			t.Fatalf("%+v: status=%d", tc, response.Code)
		}
		if (response.Header().Get("Access-Control-Allow-Origin") != "") != tc.allowed {
			t.Fatalf("unexpected CORS for %+v", tc)
		}
	}
}

func TestAccessLogsOmitQueryAndRecoveryOmitsPanicDetails(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	handler := New(Options{Logger: logger})
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/livez?token=private-query", nil))
	if strings.Contains(logs.String(), "private-query") {
		t.Fatal("query leaked into access log")
	}
	response := httptest.NewRecorder()
	recoverPanic(logger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("private-panic") })).ServeHTTP(response, httptest.NewRequest("GET", "/", nil))
	if response.Code != 500 || strings.Contains(logs.String()+response.Body.String(), "private-panic") {
		t.Fatal("panic leaked or not recovered")
	}
}
