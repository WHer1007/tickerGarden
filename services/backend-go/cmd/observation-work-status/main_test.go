package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestDescribeAndConfiguration(t *testing.T) {
	env := func(string) string { return "" }
	var out, stderr bytes.Buffer
	if n := run(context.Background(), []string{"--describe"}, env, &out, &stderr); n != 0 || !strings.Contains(out.String(), `"financiallyVerified":false`) {
		t.Fatal(n, out.String())
	}
	for _, args := range [][]string{nil, {"--once", "--other"}, {"--once"}} {
		out.Reset()
		stderr.Reset()
		if n := run(context.Background(), args, env, &out, &stderr); n != 1 || out.Len() != 0 {
			t.Fatal("invalid invocation succeeded")
		}
	}
	for _, age := range []string{"-1s", "0s", "25h", "bad"} {
		out.Reset()
		stderr.Reset()
		env := func(k string) string {
			if k == "TG_OBSERVATION_STATUS_MAX_PENDING_AGE" {
				return age
			}
			return "postgres://sensitive:secret@invalid"
		}
		if n := run(context.Background(), []string{"--once"}, env, &out, &stderr); n != 1 || strings.Contains(stderr.String(), "secret") {
			t.Fatal("configuration error leaked secret")
		}
	}
}
