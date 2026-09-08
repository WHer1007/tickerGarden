package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestEvidenceAtomicIdempotent(t *testing.T) {
	dir := t.TempDir()
	manifest := json.RawMessage(`{"chainId":1}`)
	result := map[string]any{"transactionSubmission": false, "referenceCheck": map[string]string{"source": "signed-test"}}
	const count = 12
	paths := make(chan string, count)
	var wg sync.WaitGroup
	for range count {
		wg.Add(1)
		go func() {
			defer wg.Done()
			path, digest, err := writeEvidence(dir, manifest, result)
			if err != nil {
				t.Error(err)
				return
			}
			body, err := os.ReadFile(path)
			if err != nil {
				t.Error(err)
				return
			}
			sum := sha256.Sum256(body)
			if hex.EncodeToString(sum[:]) != digest {
				t.Error("digest mismatch")
			}
			paths <- path
		}()
	}
	wg.Wait()
	close(paths)
	var first string
	for path := range paths {
		if first != "" && first != path {
			t.Fatal("not idempotent")
		}
		first = path
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("temporary files or missing snapshot: %v %v", entries, err)
	}
	info, _ := os.Stat(first)
	if info.Mode().Perm() != 0600 {
		t.Fatalf("permissions %v", info.Mode())
	}
	body, _ := os.ReadFile(first)
	var envelope struct {
		Version  string
		Manifest map[string]any
		Result   map[string]any
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.Version != "tickergarden-conversion-evidence-v1" || envelope.Result["transactionSubmission"] != false || envelope.Manifest["chainId"] != float64(1) {
		t.Fatalf("bad envelope %s", body)
	}
	// Existing corruption must never be silently replaced.
	if err := os.WriteFile(first, []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := writeEvidence(dir, manifest, result); err == nil {
		t.Fatal("accepted corrupt evidence")
	}
	body, _ = os.ReadFile(first)
	if string(body) != "corrupt" {
		t.Fatal("overwrote existing evidence")
	}
}

func TestEvidenceRejectsUnsafePathsAndInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "link")
	if err := os.Symlink(dir, target); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{target, filepath.Join(dir, "missing")} {
		if _, _, err := writeEvidence(path, json.RawMessage(`{}`), nil); err == nil {
			t.Fatal("accepted directory", path)
		}
	}
	if _, _, err := writeEvidence(dir, json.RawMessage(`broken`), nil); err == nil {
		t.Fatal("accepted malformed manifest")
	}
	path, _, err := writeEvidence(dir, json.RawMessage(`{}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
	if _, _, err := writeEvidence(dir, json.RawMessage(`{}`), nil); err == nil {
		t.Fatal("accepted target symlink")
	}
}

func TestEvidenceFlagRequiresCheckedMode(t *testing.T) {
	for _, mode := range []string{"--preview", "--observed-plan", "--observe-state", "--plan"} {
		var out bytes.Buffer
		if err := run([]string{mode, "unused", "--manifest", "unused", "--evidence-dir", t.TempDir()}, &out); err == nil || out.Len() != 0 {
			t.Fatalf("accepted unchecked mode %s", mode)
		}
	}
}
