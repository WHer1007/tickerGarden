package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// Evidence is an audit snapshot, never an execution authorization. The caller
// must complete live verification before invoking this writer.
func writeEvidence(dir string, manifest json.RawMessage, result any) (string, string, error) {
	body, err := json.Marshal(struct {
		Version  string          `json:"version"`
		Manifest json.RawMessage `json:"manifest"`
		Result   any             `json:"result"`
	}{"tickergarden-conversion-evidence-v1", manifest, result})
	if err != nil {
		return "", "", err
	}
	body = append(body, '\n')
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	absolute, err := filepath.Abs(dir)
	if err != nil {
		return "", "", err
	}
	// Require an existing operator-managed directory; do not silently choose a
	// fallback location or create a directory with inherited public permissions.
	info, err := os.Lstat(absolute)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", "", errors.New("evidence directory must be an existing real directory")
	}
	target := filepath.Join(absolute, digest+".json")
	tmp, err := os.CreateTemp(absolute, ".conversion-evidence-*")
	if err != nil {
		return "", "", err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if _, err = tmp.Write(body); err != nil {
		return "", "", err
	}
	if err = tmp.Sync(); err != nil {
		return "", "", err
	}
	if err = tmp.Close(); err != nil {
		return "", "", err
	}
	// Hard-link publication is atomic and cannot overwrite an existing snapshot.
	if err = os.Link(tmp.Name(), target); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return "", "", err
		}
		info, statErr := os.Lstat(target)
		if statErr != nil || !info.Mode().IsRegular() {
			return "", "", errors.New("existing evidence is not a regular file")
		}
		existing, readErr := readEvidenceBounded(target, len(body))
		if readErr != nil || !bytes.Equal(existing, body) {
			return "", "", errors.New("existing evidence does not match its digest")
		}
	}
	directory, err := os.Open(absolute)
	if err != nil {
		return "", "", err
	}
	defer directory.Close()
	if err = directory.Sync(); err != nil {
		return "", "", err
	}
	return target, digest, nil
}

func readEvidenceBounded(path string, size int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, int64(size)+1))
}
