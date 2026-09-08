package main

import (
	"bytes"
	"testing"
)

func TestReceiptModesRejectMixedArguments(t *testing.T) {
	for _, args := range [][]string{{"--observe-receipt", "key", "--submit"}, {"--observe-receipt", "key", "--after", "1"}, {"--observe-receipt", "key", "--receipt-history", "key"}, {"--receipt-history", "key", "--owner", "x"}, {"--receipt-history", "key", "--after", "-1"}} {
		var out bytes.Buffer
		e := run(args, &out)
		if e == nil || e.Error() != "invalid receipt mode arguments" || out.Len() != 0 {
			t.Fatalf("%v: %v", args, e)
		}
	}
}
