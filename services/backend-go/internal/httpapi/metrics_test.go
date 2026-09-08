package httpapi

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/readmodel"

	"github.com/go-chi/chi/v5"
)

func TestMetricsRoutesPrivacyAndConcurrency(t *testing.T) {
	h := New(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			path := fmt.Sprintf("/v1/users/0x%040x/rewards?secret=private-value", i)
			h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", path, nil))
		}(i)
	}
	wg.Wait()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/private-value", nil))
	scrape := func() string {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
		if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Type"), "version=0.0.4") {
			t.Fatal(w)
		}
		return w.Body.String()
	}
	first, second := scrape(), scrape()
	if first != second {
		t.Fatal("scrapes mutate counters")
	}
	if strings.Contains(first, "private-value") || strings.Contains(first, "0x000") || strings.Contains(first, "secret") {
		t.Fatal("request values leaked", first)
	}
	for _, want := range []string{
		`tickergarden_http_requests_total{route="/v1/users/{address}/rewards",method="GET",status_class="4xx"} 40`,
		`tickergarden_http_requests_total{route="unmatched",method="GET",status_class="4xx"} 1`,
		`tickergarden_http_request_duration_seconds_bucket{route="/v1/users/{address}/rewards",method="GET",status_class="4xx",le="+Inf"} 40`,
		"tickergarden_http_in_flight 0",
	} {
		if !strings.Contains(first, want) {
			t.Fatal("missing metric", want, first)
		}
	}
}

func TestMetricsPanicIsServerError(t *testing.T) {
	h := New(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Database: pingFunc(func(context.Context) error { panic("private panic") })})
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/readyz", nil))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	if !strings.Contains(w.Body.String(), `route="/readyz",method="GET",status_class="5xx"} 1`) {
		t.Fatal(w.Body.String())
	}
}

func TestMetricsInFlight(t *testing.T) {
	m := newHTTPMetrics()
	r := chi.NewRouter()
	r.Use(m.observe)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	r.Get("/slow", func(w http.ResponseWriter, r *http.Request) { close(entered); <-release; w.WriteHeader(204) })
	go func() {
		defer close(done)
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/slow", nil))
	}()
	<-entered
	w := httptest.NewRecorder()
	m.ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	close(release)
	<-done
	if !strings.Contains(w.Body.String(), "tickergarden_http_in_flight 1") {
		t.Fatal(w.Body.String())
	}
	if m.inFlight.Load() != 0 {
		t.Fatal("inflight not cleared")
	}
}

func TestMetricsReadinessTransitions(t *testing.T) {
	var phase, loads atomic.Int32
	h := New(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Database: pingFunc(func(context.Context) error {
		if phase.Load() == 2 {
			return fmt.Errorf("unavailable")
		}
		if phase.Load() == 3 {
			panic("unavailable")
		}
		return nil
	}), ReadModels: readerFunc(func(context.Context, string) (readmodel.Snapshot, error) {
		loads.Add(1)
		s := readmodel.Snapshot{}
		if phase.Load() != 0 {
			s.Sync.Status = "synced"
		}
		return s, nil
	})})
	scrape := func() string {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
		return w.Body.String()
	}
	first := scrape()
	if !strings.Contains(first, "tickergarden_api_ready -1\n") || !strings.Contains(first, "tickergarden_api_readiness_observed_timestamp_seconds 0\n") || loads.Load() != 0 {
		t.Fatal(first)
	}
	for _, step := range []struct {
		phase int32
		ready string
	}{{0, "0"}, {1, "1"}, {2, "0"}, {1, "1"}, {3, "0"}} {
		phase.Store(step.phase)
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/readyz", nil))
		before := loads.Load()
		body := scrape()
		if !strings.Contains(body, "tickergarden_api_ready "+step.ready+"\n") || strings.Contains(body, "tickergarden_api_readiness_observed_timestamp_seconds 0\n") || loads.Load() != before {
			t.Fatal(body)
		}
	}
}

func TestMetricsReadinessRejectsLateOlderProbe(t *testing.T) {
	for _, oldCode := range []int{200, 503} {
		t.Run(fmt.Sprint(oldCode), func(t *testing.T) {
			m := newHTTPMetrics()
			r := chi.NewRouter()
			r.Use(m.observe)
			entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			newerCode := 503
			if oldCode == 503 {
				newerCode = 200
			}
			r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) == 1 {
					close(entered)
					<-release
					w.WriteHeader(oldCode)
					return
				}
				w.WriteHeader(newerCode)
			})
			go func() {
				defer close(done)
				r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/readyz", nil))
			}()
			<-entered
			r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/readyz", nil))
			m.mu.Lock()
			before, observed := m.ready, m.readinessObserved
			m.mu.Unlock()
			close(release)
			<-done
			m.mu.Lock()
			after, afterObserved := m.ready, m.readinessObserved
			seq := m.readinessSequence
			m.mu.Unlock()
			want := 0
			if newerCode == 200 {
				want = 1
			}
			if before != want || after != want || observed != afterObserved || seq != 2 {
				t.Fatal("older probe overwrote newer result", before, after, seq)
			}
			if m.inFlight.Load() != 0 {
				t.Fatal("inflight leak")
			}
		})
	}
}
