package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func validJSON() string {
	return `{"config":{"maxAccounts":1},"registration":{},"actions":[],"block":{}}`
}
func TestDescribeNoEnv(t *testing.T) {
	var o, e bytes.Buffer
	if got := run(t.Context(), []string{"--describe"}, &o, &e); got != 0 || !strings.Contains(o.String(), "holder-reconcile") || e.Len() != 0 {
		t.Fatalf("%d %s %s", got, o.String(), e.String())
	}
}
func TestRunArgumentRejects(t *testing.T) {
	var o, e bytes.Buffer
	if got := run(t.Context(), nil, &o, &e); got != 1 {
		t.Fatalf("got %d", got)
	}
}
func TestDecodeDigest(t *testing.T) {
	raw := []byte(validJSON())
	in, d, e := decode(bytes.NewReader(raw))
	if e != nil || in.Config.MaxAccounts != 1 {
		t.Fatal(e)
	}
	s := sha256.Sum256(raw)
	if d != hex.EncodeToString(s[:]) {
		t.Fatalf("digest %s", d)
	}
}
func TestDecodeRejectsUnknownTrailingAndOversize(t *testing.T) {
	if _, _, e := decode(strings.NewReader(validJSON() + " " + `{"x":1}`)); e == nil {
		t.Fatal("trailing accepted")
	}
	if _, _, e := decode(strings.NewReader(strings.Repeat("x", 4<<20+1))); e == nil {
		t.Fatal("oversize accepted")
	}
}
func TestDecodeRejectsUnknownFieldAndBudget(t *testing.T) {
	if _, _, e := decode(strings.NewReader(`{"config":{"maxAccounts":1},"unknown":1}`)); e == nil {
		t.Fatal("unknown accepted")
	}
	if _, _, e := decode(strings.NewReader(`{"config":{"maxAccounts":10000},"actions":[` + strings.TrimSuffix(strings.Repeat("null,", 4096), ",") + `]}`)); e == nil {
		t.Fatal("budget accepted")
	}
}
