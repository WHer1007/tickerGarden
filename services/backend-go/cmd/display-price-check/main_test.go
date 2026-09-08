package main

import (
	"bytes"
	"context"
	"testing"
)

func TestInvalidArguments(t *testing.T) {
	for _, args := range [][]string{nil, {"--chain-id", "4663"}, {"--config", "missing", "--chain-id", "4663"}, {"--config", "missing", "--chain-id", "4663", "extra"}, {"--chain-id", "bad"}} {
		var out, diagnostics bytes.Buffer
		if code := run(context.Background(), args, &out, &diagnostics); code != 2 || out.Len() != 0 || diagnostics.Len() == 0 {
			t.Fatalf("args %v: unexpected output/code %d", args, code)
		}
	}
}
