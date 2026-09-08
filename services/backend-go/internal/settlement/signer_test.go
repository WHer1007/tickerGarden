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

func TestExecSignerProtocolAndBounds(t *testing.T) {
	r, raw := signedFixture(t)
	r.Intent.Deadline = time.Now().Unix() + 60
	body, _ := json.Marshal(r.Intent)
	sum := sha256.Sum256(body)
	r.Digest = hex.EncodeToString(sum[:])
	proof := "{}"
	ps := sha256.Sum256([]byte(proof))
	q := SignRequest{Version: "settlement-sign-v1", RequestID: r.Digest, Intent: r, CheckSequence: 1, CheckDigest: hex.EncodeToString(ps[:]), EvidenceJSON: proof, NotAfter: time.Now().Unix() + 20}
	path := filepath.Join(t.TempDir(), "signer")
	script := "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '0x" + hex.EncodeToString(raw) + "'\n"
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	got, err := (ExecSigner{Path: path}).Sign(context.Background(), q)
	if err != nil || hex.EncodeToString(got) != hex.EncodeToString(raw) {
		t.Fatal(err)
	}
	for _, bad := range []SignRequest{func() SignRequest { x := q; x.Version = "maintenance-sign-v1"; return x }(), func() SignRequest { x := q; x.NotAfter = time.Now().Unix() - 1; return x }(), func() SignRequest { x := q; x.CheckDigest = "bad"; return x }()} {
		if _, err := (ExecSigner{Path: path}).Sign(context.Background(), bad); err == nil {
			t.Fatal("bad request accepted")
		}
	}
	if _, err := (ExecSigner{Path: "relative"}).Sign(context.Background(), q); err == nil {
		t.Fatal("relative executable")
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\ncat >/dev/null\nprintf garbage\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := (ExecSigner{Path: path}).Sign(context.Background(), q); err == nil {
		t.Fatal("invalid output")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (ExecSigner{Path: path}).Sign(ctx, q); err == nil {
		t.Fatal("cancelled request")
	}
}
