package main

import (
	"bytes"
	"testing"
)

func TestNonceCLIRejectsAmbiguousModes(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want string
	}{
		{[]string{"--reserve-nonce"}, "reserve-nonce requires preview, owner, token and generation; no job/ttl"},
		{[]string{"--reserve-nonce", "--preview", "--owner", "worker", "--token", "token"}, "reserve-nonce requires preview, owner, token and generation; no job/ttl"},
		{[]string{"--lease", "acquire", "--reserve-nonce"}, "invalid lease mode or arguments"},
		{[]string{"--reservation", "key", "--preview"}, "reservation inspection accepts only --reservation"},
	} {
		var out bytes.Buffer
		if err := run(tc.args, &out); err == nil || err.Error() != tc.want || out.Len() != 0 {
			t.Fatal(tc.args, err, out.String())
		}
	}
}
