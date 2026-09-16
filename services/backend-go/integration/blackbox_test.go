package integration

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/httpapi"
)

func TestBlackboxReadinessIntegration(t *testing.T) {
	binary := os.Getenv("TG_TEST_BLACKBOX")
	if binary == "" {
		t.Skip("set TG_TEST_BLACKBOX to exporter executable")
	}
	executable, e := exec.LookPath(binary)
	if e != nil {
		t.Fatal(e)
	}
	config, e := filepath.Abs("../monitoring/blackbox.yml")
	if e != nil {
		t.Fatal(e)
	}
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	address := listener.Addr().String()
	listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	logPath := filepath.Join(t.TempDir(), "blackbox.log")
	logFile, e := os.Create(logPath)
	if e != nil {
		t.Fatal(e)
	}
	command := exec.CommandContext(ctx, executable, "--config.file="+config, "--web.listen-address="+address)
	command.Stdout = logFile
	command.Stderr = logFile
	if e := command.Start(); e != nil {
		logFile.Close()
		t.Fatal(e)
	}
	done := make(chan struct{})
	var waitErr error
	go func() { waitErr = command.Wait(); close(done) }()
	defer func() {
		cancel()
		<-done
		logFile.Close()
		if t.Failed() {
			data, _ := os.ReadFile(logPath)
			t.Log(string(data))
		}
	}()
	client := &http.Client{Timeout: 5 * time.Second}
	endpoint := "http://" + address
	for {
		select {
		case <-done:
			t.Fatal("exporter exited", waitErr)
		case <-ctx.Done():
			t.Fatal("exporter startup timeout")
		default:
		}
		response, e := client.Get(endpoint + "/")
		if e == nil {
			response.Body.Close()
			if response.StatusCode == 200 {
				break
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(25 * time.Millisecond):
		}
	}
	state := &metricsProbe{}
	api := httptest.NewServer(httpapi.New(httpapi.Options{Database: state, ReadModels: state, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}))
	defer api.Close()
	for _, ready := range []bool{false, true, false, true} {
		state.ready.Store(ready)
		response, e := client.Get(endpoint + "/probe?module=http_2xx&target=" + url.QueryEscape(api.URL+"/readyz"))
		if e != nil {
			t.Fatal(e)
		}
		data, e := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		response.Body.Close()
		if e != nil || response.StatusCode != 200 {
			t.Fatal(response.StatusCode, e)
		}
		success, status := "0", "503"
		if ready {
			success, status = "1", "200"
		}
		body := string(data)
		if !strings.Contains(body, "\nprobe_success "+success+"\n") || !strings.Contains(body, "\nprobe_http_status_code "+status+"\n") {
			t.Fatal("wrong readiness probe", body)
		}
		metrics, e := client.Get(api.URL + "/metrics")
		if e != nil {
			t.Fatal(e)
		}
		raw, e := io.ReadAll(io.LimitReader(metrics.Body, 1<<20))
		metrics.Body.Close()
		if e != nil || !strings.Contains(string(raw), "tickergarden_api_ready "+success+"\n") {
			t.Fatal("probe did not update API readiness", e, string(raw))
		}
	}
}
