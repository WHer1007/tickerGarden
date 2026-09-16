package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"syscall"
	"time"

	"tickergarden/backend/internal/readmodel"
)

type publishFunc func(context.Context, []byte, time.Time, io.Writer) error

// Producer must atomically rename one complete envelope into place. Watch never
// synthesizes a verification timestamp or promotes local candidate eligibility.
func readEnvelope(path string) ([]byte, time.Time, string, error) {
	fail := func() ([]byte, time.Time, string, error) {
		return nil, time.Time{}, "", errors.New("invalid or unavailable producer envelope")
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return fail()
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return fail()
	}
	raw, err := io.ReadAll(io.LimitReader(f, readmodel.MaxSnapshotBytes+4097))
	if err != nil || len(raw) > readmodel.MaxSnapshotBytes+4096 {
		return fail()
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return fail()
	}
	fields := map[string]json.RawMessage{}
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return fail()
		}
		key, ok := token.(string)
		if !ok || (key != "snapshot" && key != "verifiedAt") {
			return fail()
		}
		if _, exists := fields[key]; exists {
			return fail()
		}
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return fail()
		}
		fields[key] = value
	}
	if _, err = decoder.Token(); err != nil {
		return fail()
	}
	if _, err = decoder.Token(); err != io.EOF {
		return fail()
	}
	var timestamp string
	if len(fields) != 2 || json.Unmarshal(fields["verifiedAt"], &timestamp) != nil {
		return fail()
	}
	at, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return fail()
	}
	snapshot := fields["snapshot"]
	if len(snapshot) == 0 || len(snapshot) > readmodel.MaxSnapshotBytes {
		return fail()
	}
	sum := sha256.Sum256(raw)
	return snapshot, at, hex.EncodeToString(sum[:]), nil
}

func watch(ctx context.Context, path string, out io.Writer, interval time.Duration, publish publishFunc) error {
	if interval <= 0 {
		return errors.New("invalid watch interval")
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	lastPublished := ""
	encoder := json.NewEncoder(out)
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		data, at, digest, err := readEnvelope(path)
		if err == nil && digest != lastPublished {
			err = publish(ctx, data, at, io.Discard)
			if err == nil {
				lastPublished = digest
				if e := encoder.Encode(map[string]any{"status": "published", "envelopeDigest": digest, "transactionSubmission": false}); e != nil {
					return e
				}
			}
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			// Never print snapshot payload or database connection details.
			if e := encoder.Encode(map[string]any{"status": "retry_pending", "transactionSubmission": false}); e != nil {
				return e
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
