package main

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Real process + PostgreSQL lock wait. No production database or fixture publication.
func TestPublisherSIGTERMDuringDatabaseWait(t *testing.T) {
	t.Run("once", func(t *testing.T) { testPublisherSignal(t, false) })
	t.Run("watch", func(t *testing.T) { testPublisherSignal(t, true) })
}
func testPublisherSignal(t *testing.T, watchMode bool) {
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TG_TEST_DATABASE_URL for isolated PostgreSQL test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_publisher_signal_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, e := admin.Exec(cleanup, "DROP DATABASE "+quoted+" WITH (FORCE)"); e != nil {
			t.Error(e)
		}
	}()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	locker, err := pgx.Connect(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer locker.Close(context.Background())
	if _, err = locker.Exec(ctx, "SELECT pg_advisory_lock($1)", int64(730000000+46630)); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "publisher")
	build := exec.CommandContext(ctx, "go", "build", "-o", binary, ".")
	if output, e := build.CombinedOutput(); e != nil {
		t.Fatalf("build: %v %s", e, output)
	}
	fixture, err := filepath.Abs("../../internal/readmodel/testdata/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	args := []string{fixture, time.Now().Format(time.RFC3339Nano)}
	expectedError := "cannot lock publication"
	if watchMode {
		data, e := os.ReadFile(fixture)
		if e != nil {
			t.Fatal(e)
		}
		envelope := filepath.Join(t.TempDir(), "producer.json")
		writeEnvelope(t, envelope, time.Now(), string(data))
		args = []string{"--watch", envelope}
		expectedError = "context canceled"
	}
	command := exec.CommandContext(ctx, binary, args...)
	// Keep machine defaults but replace all publisher-specific configuration.
	overrides := map[string]string{"TG_CHAIN_ID": "46630", "TG_PUBLISHER_DATABASE_URL": u.String(), "TG_PUBLISH_ACCOUNTS": "false", "TG_PUBLISH_IDENTITIES": "false"}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if _, ok := overrides[key]; !ok {
			command.Env = append(command.Env, entry)
		}
	}
	for key, value := range overrides {
		command.Env = append(command.Env, key+"="+value)
	}
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	finished := false
	defer func() {
		if !finished {
			command.Process.Kill()
			<-done
		}
	}()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	for {
		var waiting bool
		err = admin.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND application_name='tickergarden-backend' AND wait_event_type='Lock' AND wait_event='advisory')`, name).Scan(&waiting)
		if err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case e := <-done:
			finished = true
			t.Fatalf("publisher exited before waiting: %v %s", e, stderr.String())
		case <-deadline.C:
			t.Fatal("publisher never reached database lock")
		case <-ticker.C:
		}
	}
	if err = command.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case e := <-done:
		finished = true
		if e == nil || command.ProcessState.ExitCode() != 1 || stdout.Len() != 0 || !strings.Contains(stderr.String(), expectedError) {
			t.Fatalf("invalid cancellation result: %v stdout=%q stderr=%q", e, stdout.String(), stderr.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("SIGTERM did not terminate database wait")
	}
	// The process can exit before PostgreSQL has observed socket closure.
	cleanupDeadline := time.Now().Add(2 * time.Second)
	for {
		var remaining int
		if err = admin.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE datname=$1 AND application_name='tickergarden-backend'`, name).Scan(&remaining); err != nil {
			t.Fatal(err)
		}
		if remaining == 0 {
			break
		}
		if time.Now().After(cleanupDeadline) {
			t.Fatal("publisher connection leaked", remaining)
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}
