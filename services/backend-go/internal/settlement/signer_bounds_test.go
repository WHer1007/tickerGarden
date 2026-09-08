package settlement

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func signerTestRequest(t *testing.T) SignRequest {
	t.Helper()
	r, _ := signedFixture(t)
	r.Intent.Deadline = time.Now().Unix() + 60
	body, err := json.Marshal(r.Intent)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	r.Digest = hex.EncodeToString(sum[:])
	proof := "{}"
	digest := sha256.Sum256([]byte(proof))
	return SignRequest{Version: "settlement-sign-v1", RequestID: r.Digest, Intent: r, CheckSequence: 1, CheckDigest: hex.EncodeToString(digest[:]), EvidenceJSON: proof, NotAfter: time.Now().Unix() + 30}
}

func TestExecSignerRejectsExcessiveStdout(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "flood")
	marker := filepath.Join(dir, "started")
	t.Setenv("TG_TEST_SIGNER_MARKER", marker)
	if err := os.WriteFile(path, []byte("#!/bin/sh\ncat >/dev/null\nprintf started > \"$TG_TEST_SIGNER_MARKER\"\nexec head -c 40000 /dev/zero\n"), 0700); err != nil {
		t.Fatal(err)
	}
	q := signerTestRequest(t)
	if _, err := (ExecSigner{Path: path}).Sign(context.Background(), q); err == nil {
		t.Fatal("accepted excessive stdout")
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatal("output test did not invoke signer", err)
	}
}

func TestExecSignerCancellationAfterProcessStart(t *testing.T) {
	dir := t.TempDir()
	path, marker := filepath.Join(dir, "wait"), filepath.Join(dir, "started")
	t.Setenv("TG_TEST_SIGNER_MARKER", marker)
	script := "#!/bin/sh\ncat >/dev/null\nprintf started > \"$TG_TEST_SIGNER_MARKER\"\nexec sleep 30\n"
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	q := signerTestRequest(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := (ExecSigner{Path: path}).Sign(ctx, q); done <- err }()
	// Startup can contend with parallel race builds; measure cancellation only
	// after the executable confirms it started.
	deadline := time.Now().Add(10 * time.Second)
	for {
		select {
		case err := <-done:
			t.Fatalf("signer exited before start marker: %v", err)
		default:
		}
		if _, err := os.Stat(marker); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("process did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled signer succeeded")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancellation exceeded bound")
	}
}

func TestSigningOutputLimit(t *testing.T) {
	var out signingOutput
	if n, err := out.Write(make([]byte, 32772)); n != 32772 || err != nil {
		t.Fatal(n, err)
	}
	if n, err := out.Write([]byte{1}); n != 0 || err == nil || out.Len() != 32772 {
		t.Fatal(n, err, out.Len())
	}
}
