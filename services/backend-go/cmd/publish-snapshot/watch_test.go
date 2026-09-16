package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeEnvelope(t *testing.T, path string, at time.Time, snapshot string) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"verifiedAt": at.Format(time.RFC3339Nano), "snapshot": json.RawMessage(snapshot)})
	if err != nil {
		t.Fatal(err)
	}
	temporary := path + ".tmp"
	if err = os.WriteFile(temporary, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(temporary, path); err != nil {
		t.Fatal(err)
	}
}
func TestEnvelopeRejectsAmbiguity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "envelope.json")
	for _, raw := range []string{`{}`, `{"snapshot":{},"verifiedAt":"bad"}`, `{"snapshot":{},"snapshot":{},"verifiedAt":"2026-01-01T00:00:00Z"}`, `{"snapshot":{},"verifiedAt":"2026-01-01T00:00:00Z","extra":1}`, `{"snapshot":{},"verifiedAt":"2026-01-01T00:00:00Z"} {}`} {
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if data, _, _, err := readEnvelope(path); err == nil || data != nil {
			t.Fatal("invalid envelope accepted", raw)
		}
	}
}
func TestWatchRetryKeepsProducerTime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "envelope.json")
	at := time.Now().Add(-time.Second).UTC()
	writeEnvelope(t, path, at, `{"fixture":1}`)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var output bytes.Buffer
	calls := 0
	err := watch(ctx, path, &output, time.Millisecond, func(_ context.Context, data []byte, got time.Time, _ io.Writer) error {
		calls++
		if !got.Equal(at) || string(data) != `{"fixture":1}` {
			t.Fatal("producer data changed")
		}
		if calls < 3 {
			return errors.New("transient private database error")
		}
		cancel()
		return nil
	})
	if !errors.Is(err, context.Canceled) || calls != 3 || strings.Count(output.String(), "retry_pending") != 2 || strings.Count(output.String(), `"status":"published"`) != 1 || strings.Contains(output.String(), "private") {
		t.Fatal(calls, err, output.String())
	}
}
func TestWatchSkipsUnchangedSuccessfulEnvelope(t *testing.T) {
	path := filepath.Join(t.TempDir(), "envelope.json")
	writeEnvelope(t, path, time.Now(), `{}`)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	calls := 0
	err := watch(ctx, path, io.Discard, time.Millisecond, func(context.Context, []byte, time.Time, io.Writer) error { calls++; return nil })
	if !errors.Is(err, context.DeadlineExceeded) || calls != 1 {
		t.Fatal(calls, err)
	}
}

type watchWriter func([]byte) (int, error)

func (f watchWriter) Write(b []byte) (int, error) { return f(b) }
func TestWatchReadsAtomicReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "envelope.json")
	at := time.Now()
	writeEnvelope(t, path, at, `{"sequence":1}`)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	count := 0
	output := watchWriter(func(b []byte) (int, error) {
		if !bytes.Contains(b, []byte(`"status":"published"`)) {
			t.Fatal(string(b))
		}
		if count == 1 {
			writeEnvelope(t, path, at, `{"sequence":2}`)
		} else {
			cancel()
		}
		return len(b), nil
	})
	err := watch(ctx, path, output, time.Millisecond, func(_ context.Context, data []byte, _ time.Time, _ io.Writer) error {
		count++
		expected := `{"sequence":1}`
		if count == 2 {
			expected = `{"sequence":2}`
		}
		if string(data) != expected {
			t.Fatal(string(data))
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) || count != 2 {
		t.Fatal(count, err)
	}
}
