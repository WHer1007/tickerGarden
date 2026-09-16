package integration

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"tickergarden/backend/internal/httpapi"
	"tickergarden/backend/internal/readmodel"
)

type metricsProbe struct{ ready atomic.Bool }

func (p *metricsProbe) Ping(context.Context) error {
	if !p.ready.Load() {
		return fmt.Errorf("test database unavailable")
	}
	return nil
}
func (p *metricsProbe) Load(context.Context, string) (readmodel.Snapshot, error) {
	s := readmodel.Snapshot{}
	if p.ready.Load() {
		s.Sync.Status = "synced"
	}
	return s, nil
}

func TestMetricsPrometheusCompatibility(t *testing.T) {
	tool := os.Getenv("TG_TEST_PROMTOOL")
	if tool == "" {
		t.Skip("set TG_TEST_PROMTOOL to promtool executable")
	}
	path, e := exec.LookPath(tool)
	if e != nil {
		t.Fatal("promtool unavailable")
	}
	probe := &metricsProbe{}
	server := httptest.NewServer(httpapi.New(httpapi.Options{Database: probe, ReadModels: probe, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}))
	defer server.Close()
	client := &http.Client{Timeout: 5 * time.Second}
	get := func(t *testing.T, path string) (int, []byte) {
		t.Helper()
		res, e := client.Get(server.URL + path)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		body, e := io.ReadAll(io.LimitReader(res.Body, 4<<20))
		if e != nil {
			t.Fatal(e)
		}
		return res.StatusCode, body
	}
	for _, phase := range []string{"unobserved", "not ready", "ready", "failed", "recovered"} {
		t.Run(phase, func(t *testing.T) {
			ready := phase == "ready" || phase == "recovered"
			probe.ready.Store(ready)
			expected := "-1"
			if phase != "unobserved" {
				status, _ := get(t, "/readyz")
				expected = "0"
				want := 503
				if ready {
					want = 200
					expected = "1"
				}
				if status != want {
					t.Fatal(status, want)
				}
			}
			get(t, "/livez")
			get(t, "/missing-private-path?wallet=private-wallet")
			status, body := get(t, "/metrics")
			if status != 200 {
				t.Fatal(status)
			}
			if !bytes.Contains(body, []byte("tickergarden_api_ready "+expected+"\n")) {
				t.Fatal("wrong readiness", string(body))
			}
			if bytes.Contains(body, []byte("private-wallet")) || bytes.Contains(body, []byte("missing-private-path")) {
				t.Fatal("metric label leak")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, path, "check", "metrics")
			command.Stdin = bytes.NewReader(body)
			output, e := command.CombinedOutput()
			if e != nil {
				t.Fatalf("Prometheus rejected metrics: %v %s", e, output)
			}
			if strings.TrimSpace(string(output)) != "" {
				t.Fatalf("unexpected Prometheus lint warnings: %s", output)
			}
		})
	}
}
