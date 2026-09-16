package main

import (
	"bytes"
	"testing"
)

func TestIntentCLIRequiresExplicitFeesAndLease(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want string
	}{
		{[]string{"--prepare-intent"}, "prepare-intent requires preview, fees and current lease; cannot reserve nonce simultaneously"},
		{[]string{"--preview", "--prepare-intent", "--reserve-nonce"}, "prepare-intent requires preview, fees and current lease; cannot reserve nonce simultaneously"},
		{[]string{"--gas-limit", "21000"}, "fee arguments require prepare-intent"},
		{[]string{"--intent", "key", "--preview"}, "intent inspection accepts only --intent"},
	} {
		var out bytes.Buffer
		if err := run(tc.args, &out); err == nil || err.Error() != tc.want || out.Len() != 0 {
			t.Fatal(tc.args, err, out.String())
		}
	}
}
