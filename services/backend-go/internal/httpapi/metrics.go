package httpapi

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

var requestBuckets = [...]float64{0.005, 0.025, 0.1, 0.5, 1, 5}

type metricKey struct{ route, method, status string }
type requestMetric struct {
	count   uint64
	seconds float64
	buckets [len(requestBuckets)]uint64
}
type httpMetrics struct {
	mu                sync.Mutex
	requests          map[metricKey]requestMetric
	inFlight          atomic.Int64
	ready             int
	readinessObserved int64
	readinessSequence uint64
	probeSequence     atomic.Uint64
}

func newHTTPMetrics() *httpMetrics {
	return &httpMetrics{requests: map[metricKey]requestMetric{}, ready: -1}
}
func (m *httpMetrics) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		var probe uint64
		if r.URL.Path == "/readyz" && r.Method == http.MethodGet {
			probe = m.probeSequence.Add(1)
		}
		m.inFlight.Add(1)
		wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		defer func() {
			m.inFlight.Add(-1)
			route := "unmatched"
			if ctx := chi.RouteContext(r.Context()); ctx != nil && ctx.RoutePattern() != "" {
				route = ctx.RoutePattern()
			}
			method := r.Method
			switch method {
			case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
			default:
				method = "other"
			}
			status := wrapped.Status()
			if status == 0 {
				status = 200
			}
			class := status / 100
			if class < 1 || class > 5 {
				class = 5
			}
			key := metricKey{route: route, method: method, status: strconv.Itoa(class) + "xx"}
			elapsed := time.Since(start).Seconds()
			m.mu.Lock()
			v := m.requests[key]
			v.count++
			v.seconds += elapsed
			for i, b := range requestBuckets {
				if elapsed <= b {
					v.buckets[i]++
				}
			}
			m.requests[key] = v
			if route == "/readyz" && method == http.MethodGet && probe > m.readinessSequence {
				m.readinessSequence = probe
				m.ready = 0
				if status == http.StatusOK {
					m.ready = 1
				}
				m.readinessObserved = time.Now().Unix()
			}
			m.mu.Unlock()
		}()
		next.ServeHTTP(wrapped, r)
	})
}
func (m *httpMetrics) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Copy before writing so a slow scrape never holds the request accounting lock.
	m.mu.Lock()
	values := make(map[metricKey]requestMetric, len(m.requests))
	for k, v := range m.requests {
		values[k] = v
	}
	ready, observed := m.ready, m.readinessObserved
	m.mu.Unlock()
	keys := make([]metricKey, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := keys[i], keys[j]
		if a.route != b.route {
			return a.route < b.route
		}
		if a.method != b.method {
			return a.method < b.method
		}
		return a.status < b.status
	})
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprintln(w, "# HELP tickergarden_api_ready Result of the newest-started completed GET /readyz: 1 ready, 0 not ready, -1 unobserved. Check observation age.")
	fmt.Fprintln(w, "# TYPE tickergarden_api_ready gauge")
	fmt.Fprintf(w, "tickergarden_api_ready %d\n", ready)
	fmt.Fprintln(w, "# HELP tickergarden_api_readiness_observed_timestamp_seconds Unix completion time of the reported readiness probe; zero before any probe.")
	fmt.Fprintln(w, "# TYPE tickergarden_api_readiness_observed_timestamp_seconds gauge")
	fmt.Fprintf(w, "tickergarden_api_readiness_observed_timestamp_seconds %d\n", observed)
	fmt.Fprintln(w, "# HELP tickergarden_http_in_flight Non-scrape HTTP requests currently executing.")
	fmt.Fprintln(w, "# TYPE tickergarden_http_in_flight gauge")
	fmt.Fprintf(w, "tickergarden_http_in_flight %d\n", m.inFlight.Load())
	fmt.Fprintln(w, "# HELP tickergarden_http_requests_total Completed non-scrape HTTP requests.")
	fmt.Fprintln(w, "# TYPE tickergarden_http_requests_total counter")
	for _, k := range keys {
		fmt.Fprintf(w, "tickergarden_http_requests_total{route=%q,method=%q,status_class=%q} %d\n", k.route, k.method, k.status, values[k].count)
	}
	fmt.Fprintln(w, "# HELP tickergarden_http_request_duration_seconds Non-scrape HTTP request duration.")
	fmt.Fprintln(w, "# TYPE tickergarden_http_request_duration_seconds histogram")
	for _, k := range keys {
		v := values[k]
		labels := fmt.Sprintf("route=%q,method=%q,status_class=%q", k.route, k.method, k.status)
		for i, b := range requestBuckets {
			fmt.Fprintf(w, "tickergarden_http_request_duration_seconds_bucket{%s,le=%q} %d\n", labels, strconv.FormatFloat(b, 'g', -1, 64), v.buckets[i])
		}
		fmt.Fprintf(w, "tickergarden_http_request_duration_seconds_bucket{%s,le=\"+Inf\"} %d\n", labels, v.count)
		fmt.Fprintf(w, "tickergarden_http_request_duration_seconds_sum{%s} %s\n", labels, strconv.FormatFloat(v.seconds, 'g', -1, 64))
		fmt.Fprintf(w, "tickergarden_http_request_duration_seconds_count{%s} %d\n", labels, v.count)
	}
}
