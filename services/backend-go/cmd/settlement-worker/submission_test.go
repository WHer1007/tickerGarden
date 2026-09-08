package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestSubmitRequiresExplicitExpectedHashBeforeDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "request.json")
	if err := os.WriteFile(path, []byte(`{"chainId":4663,"jobKey":"job"}`), 0600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	err := submissionCommand(path, true, &out)
	if err == nil || err.Error() != "expectedTransactionHash is required" || out.Len() != 0 {
		t.Fatal(err, out.String())
	}
}
