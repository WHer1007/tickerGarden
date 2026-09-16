package maintenance

import (
	"context"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestExecSigner(t *testing.T) {
	in, _, raw := signedFixture(t)
	for _, tc := range []struct {
		name, script string
		good         bool
	}{
		{"valid", "cat >/dev/null\nprintf '%s\\n' '0x" + hex.EncodeToString(raw) + "'\n", true},
		{"bad", "printf 'private-error' >&2\nprintf '0x1234'\n", false},
		{"exit", "exit 1\n", false},
		{"oversize", "head -c 40000 /dev/zero\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "signer")
			if e := os.WriteFile(path, []byte("#!/bin/sh\n"+tc.script), 0700); e != nil {
				t.Fatal(e)
			}
			out, e := (ExecSigner{Path: path}).Sign(context.Background(), in)
			if tc.good {
				if e != nil || hex.EncodeToString(out) != hex.EncodeToString(raw) {
					t.Fatal(e)
				}
			} else if e == nil || strings.Contains(e.Error(), "private-error") {
				t.Fatal("invalid output accepted or stderr leaked", e)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := (ExecSigner{Path: "/bin/cat"}).Sign(ctx, in); e == nil {
		t.Fatal("cancelled signer accepted")
	}
	if _, e := (ExecSigner{Path: "relative"}).Sign(context.Background(), in); e == nil {
		t.Fatal("relative executable accepted")
	}
	path := filepath.Join(t.TempDir(), "slow")
	if e := os.WriteFile(path, []byte("#!/bin/sh\nexec /bin/sleep 5\n"), 0700); e != nil {
		t.Fatal(e)
	}
	ctx, cancel = context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, e := (ExecSigner{Path: path}).Sign(ctx, in); e == nil {
		t.Fatal("timeout accepted")
	}
}
