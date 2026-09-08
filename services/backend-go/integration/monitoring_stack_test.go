package integration

import (
	"context"
	"encoding/json"
	"fmt"
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

func startMonitoringProcess(t *testing.T, ctx context.Context, binary, readyPath string, args ...string) string {
	t.Helper()
	executable, e := exec.LookPath(binary)
	if e != nil {
		t.Fatal(e)
	}
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	address := listener.Addr().String()
	listener.Close()
	processCtx, cancel := context.WithCancel(ctx)
	logPath := filepath.Join(t.TempDir(), "process.log")
	file, e := os.Create(logPath)
	if e != nil {
		cancel()
		t.Fatal(e)
	}
	command := exec.CommandContext(processCtx, executable, append(args, "--web.listen-address="+address)...)
	command.Stdout = file
	command.Stderr = file
	if e := command.Start(); e != nil {
		file.Close()
		cancel()
		t.Fatal(e)
	}
	done := make(chan struct{})
	var waitErr error
	go func() { waitErr = command.Wait(); close(done) }()
	t.Cleanup(func() {
		cancel()
		<-done
		file.Close()
		if t.Failed() {
			data, _ := os.ReadFile(logPath)
			t.Log(string(data))
		}
	})
	endpoint := "http://" + address
	client := &http.Client{Timeout: time.Second}
	for {
		select {
		case <-done:
			t.Fatal("monitor exited", waitErr)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		default:
		}
		response, e := client.Get(endpoint + readyPath)
		if e == nil {
			response.Body.Close()
			if response.StatusCode == 200 {
				return endpoint
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func TestMonitoringStack(t *testing.T) {
	prometheus, blackbox := os.Getenv("TG_TEST_PROMETHEUS"), os.Getenv("TG_TEST_BLACKBOX")
	if prometheus == "" || blackbox == "" {
		t.Skip("set TG_TEST_PROMETHEUS and TG_TEST_BLACKBOX")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	state := &metricsProbe{}
	api := httptest.NewServer(httpapi.New(httpapi.Options{Database: state, ReadModels: state, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}))
	defer api.Close()
	config, e := filepath.Abs("../monitoring/blackbox.yml")
	if e != nil {
		t.Fatal(e)
	}
	exporter := startMonitoringProcess(t, ctx, blackbox, "/", "--config.file="+config)
	raw, e := os.ReadFile("../monitoring/prometheus.yml")
	if e != nil {
		t.Fatal(e)
	}
	rules, e := filepath.Abs("../monitoring/alerts.yml")
	if e != nil {
		t.Fatal(e)
	}
	contents := strings.NewReplacer("127.0.0.1:8790", strings.TrimPrefix(api.URL, "http://"), "127.0.0.1:9115", strings.TrimPrefix(exporter, "http://"), "scrape_interval: 15s", "scrape_interval: 250ms\n  scrape_timeout: 200ms", "evaluation_interval: 15s", "evaluation_interval: 250ms", "rule_files: [alerts.yml]", fmt.Sprintf("rule_files: [%q]", rules)).Replace(string(raw))
	dir := t.TempDir()
	path := filepath.Join(dir, "prometheus.yml")
	if e := os.WriteFile(path, []byte(contents), 0600); e != nil {
		t.Fatal(e)
	}
	endpoint := startMonitoringProcess(t, ctx, prometheus, "/-/ready", "--config.file="+path, "--storage.tsdb.path="+filepath.Join(dir, "data"), "--storage.tsdb.retention.time=1h")
	client := &http.Client{Timeout: 2 * time.Second}
	query := func(expression string) (string, bool) {
		response, e := client.Get(endpoint + "/api/v1/query?query=" + url.QueryEscape(expression))
		if e != nil {
			return "", false
		}
		defer response.Body.Close()
		var result struct {
			Status string `json:"status"`
			Data   struct {
				Result []struct {
					Value []json.RawMessage `json:"value"`
				} `json:"result"`
			} `json:"data"`
		}
		if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result) != nil || result.Status != "success" || len(result.Data.Result) != 1 || len(result.Data.Result[0].Value) != 2 {
			return "", false
		}
		var value string
		if json.Unmarshal(result.Data.Result[0].Value[1], &value) != nil {
			return "", false
		}
		return value, true
	}
	for _, ready := range []bool{false, true, false, true} {
		state.ready.Store(ready)
		want := "0"
		if ready {
			want = "1"
		}
		deadline := time.Now().Add(8 * time.Second)
		for {
			probe, pok := query(`probe_success{job="tickergarden-readiness-probe"}`)
			observed, rok := query(`tickergarden_api_ready{job="tickergarden-api"}`)
			up, uok := query(`up{job="tickergarden-api"}`)
			if pok && rok && uok && probe == want && observed == want && up == "1" {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("scrape failed to converge: want=%s probe=%s readiness=%s up=%s", want, probe, observed, up)
			}
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-time.After(100 * time.Millisecond):
			}
		}
	}
	response, e := client.Get(endpoint + "/api/v1/rules")
	if e != nil {
		t.Fatal(e)
	}
	defer response.Body.Close()
	var rulesResult struct {
		Status string `json:"status"`
		Data   struct {
			Groups []struct {
				Rules []struct {
					Health string `json:"health"`
				} `json:"rules"`
			} `json:"groups"`
		} `json:"data"`
	}
	if e := json.NewDecoder(response.Body).Decode(&rulesResult); e != nil {
		t.Fatal(e)
	}
	count := 0
	for _, group := range rulesResult.Data.Groups {
		for _, rule := range group.Rules {
			count++
			if rule.Health != "ok" {
				t.Fatal("unhealthy rule", rule)
			}
		}
	}
	if rulesResult.Status != "success" || count != 7 {
		t.Fatal("rules not loaded", count)
	}
}
