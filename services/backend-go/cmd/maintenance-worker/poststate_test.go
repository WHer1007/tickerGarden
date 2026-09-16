package main

import (
	"bytes"
	"testing"
)

func TestPoststateModeRequiresJobAndManifestOnly(t *testing.T) {
	for _, args := range [][]string{{"--verify-poststate", "job"}, {"--verify-poststate", "job", "--manifest", "file", "--submit"}, {"--verify-poststate", "job", "--manifest", "file", "--owner", "worker"}, {"--verify-poststate", "job", "--manifest", "file", "--observe-receipt", "job"}} {
		var out bytes.Buffer
		e := run(args, &out)
		if e == nil || e.Error() != "poststate verification requires only job and manifest" || out.Len() != 0 {
			t.Fatalf("%v: %v", args, e)
		}
	}
}
