package settlement

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestFetchReferencesSuccessAndLoopbackGate(t *testing.T) {
	for _, tls := range []bool{false, true} {
		p, policy, refs, _, _ := referenceFixture(t)
		var hits atomic.Int32
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			hits.Add(1)
			if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
				t.Error("unexpected method/header")
			}
			var request map[string]any
			if e := json.NewDecoder(r.Body).Decode(&request); e != nil || request["requestDigest"] != p.Candidate.Request.RequestDigest || len(request) != 7 {
				t.Error("unbound request", request, e)
			}
			i := 0
			if r.URL.Path == "/two" {
				i = 1
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(refs[i])
		})
		var s *httptest.Server
		var transport http.RoundTripper
		if tls {
			s = httptest.NewTLSServer(handler)
			transport = s.Client().Transport
		} else {
			s = httptest.NewServer(handler)
		}
		policy.AllowLoopbackHTTP = !tls
		policy.Sources[0].Endpoint = s.URL + "/one"
		policy.Sources[1].Endpoint = s.URL + "/two"
		got, e := fetchReferences(context.Background(), p, policy, transport)
		if e != nil || len(got.Sources) != 2 || hits.Load() != 2 {
			t.Fatalf("%+v %v hits%d", got, e, hits.Load())
		}
		if !tls {
			policy.AllowLoopbackHTTP = false
			if _, e := FetchReferences(context.Background(), p, policy); e == nil || hits.Load() != 2 {
				t.Fatal("loopback without opt-in")
			}
		}
		s.Close()
	}
}
func TestReferenceFetchRejectsInvalidProvider(t *testing.T) {
	for _, mode := range []string{"status", "redirect", "content type", "malformed", "trailing", "unknown", "oversize", "wrong source", "signature"} {
		t.Run(mode, func(t *testing.T) {
			p, policy, refs, _, _ := referenceFixture(t)
			var badHits, redirectHits atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/redirected" {
					redirectHits.Add(1)
					return
				}
				if r.URL.Path == "/two" {
					json.NewEncoder(w).Encode(refs[1])
					return
				}
				badHits.Add(1)
				switch mode {
				case "status":
					w.WriteHeader(503)
				case "redirect":
					w.Header().Set("Location", "/redirected")
					w.WriteHeader(302)
				case "content type":
					w.Header().Set("Content-Type", "text/plain")
					json.NewEncoder(w).Encode(refs[0])
				case "malformed":
					w.Write([]byte("no"))
				case "trailing":
					json.NewEncoder(w).Encode(refs[0])
					w.Write([]byte("{}"))
				case "unknown":
					w.Write([]byte(`{"price":{},"signature":"x","unknown":true}`))
				case "oversize":
					json.NewEncoder(w).Encode(refs[0])
					w.Write([]byte(strings.Repeat(" ", 64<<10)))
				case "wrong source":
					json.NewEncoder(w).Encode(refs[1])
				case "signature":
					ref := refs[0]
					ref.Signature = "AAAA"
					json.NewEncoder(w).Encode(ref)
				}
			}))
			defer s.Close()
			policy.AllowLoopbackHTTP = true
			policy.Sources[0].Endpoint = s.URL + "/one"
			policy.Sources[1].Endpoint = s.URL + "/two"
			got, e := FetchReferences(context.Background(), p, policy)
			expected := ErrReferenceFetch
			if mode == "signature" {
				expected = ErrReference
			}
			if e != expected || got.Sources != nil || badHits.Load() != 1 || redirectHits.Load() != 0 {
				t.Fatalf("accepted %s: %+v %v hits%d", mode, got, e, badHits.Load())
			}
		})
	}
}
func TestReferenceFetchRejectsPolicyBeforeHTTPAndCancels(t *testing.T) {
	p, policy, refs, _, _ := referenceFixture(t)
	var hits atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(refs[0])
	}))
	defer s.Close()
	policy.AllowLoopbackHTTP = true
	policy.Sources[1].Endpoint = s.URL + "/two"
	for _, endpoint := range []string{"file:///tmp/key", s.URL + "/two", s.URL + "?secret=x", s.URL + "#fragment", "http://user:pass@127.0.0.1/a", "http://localhost/a"} {
		policy.Sources[0].Endpoint = endpoint
		if _, e := FetchReferences(context.Background(), p, policy); e == nil || hits.Load() != 0 {
			t.Fatal("invalid endpoint contacted", endpoint)
		}
	}
	policy.Sources[0].Endpoint = s.URL + "/one"
	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	<-ctx.Done()
	if got, e := FetchReferences(ctx, p, policy); e == nil || got.Sources != nil {
		t.Fatal("cancellation ignored")
	}
}

func TestReferenceFetchCancelsInFlightRequests(t *testing.T) {
	p, policy, _, _, _ := referenceFixture(t)
	var hits atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		if hits.Add(1) == 2 {
			close(started)
		}
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer s.Close()
	defer close(release)
	policy.AllowLoopbackHTTP = true
	policy.Sources[0].Endpoint = s.URL + "/one"
	policy.Sources[1].Endpoint = s.URL + "/two"
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, e := FetchReferences(ctx, p, policy); done <- e }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		cancel()
		t.Fatal("requests did not start")
	}
	cancel()
	select {
	case e := <-done:
		if e != ErrReferenceFetch {
			t.Fatal(e)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("fetch did not stop")
	}
}
