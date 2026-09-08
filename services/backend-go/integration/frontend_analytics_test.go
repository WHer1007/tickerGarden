package integration

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Opt-in because Go-only environments do not necessarily provide Node 22+.
// The handler uses the live isolated PostgreSQL fixture, never mocked fetch data.
func testFrontendAnalyticsHTTP(t *testing.T, handler http.Handler, mode string, args ...string) {
	t.Helper()
	if os.Getenv("TG_TEST_WEB_INTEGRATION") != "1" {
		return
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("TG_TEST_WEB_INTEGRATION requires Node 22+:", err)
	}
	script, err := filepath.Abs("../../../apps/web/tests/integration/analytics-http.mjs")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	argv := append([]string{"--experimental-strip-types", script, server.URL, mode}, args...)
	output, err := exec.CommandContext(ctx, node, argv...).CombinedOutput()
	if err != nil {
		t.Fatalf("frontend %s: %v\n%s", mode, err, output)
	}
	t.Log(string(output))
}
