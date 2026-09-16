package maintenance

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"tickergarden/backend/internal/deployment"
	"time"
)

// Signer signs the exact persisted intent. The request digest is its stable
// request identifier; implementations must never broadcast the transaction.
type Signer interface {
	Sign(context.Context, IntentRecord) ([]byte, error)
}

// ExecSigner invokes an explicitly configured executable without a shell. The
// operator owns that program's credentials; the worker passes no private key.
type ExecSigner struct{ Path string }
type boundedSigningOutput struct{ bytes.Buffer }

func (w *boundedSigningOutput) Write(p []byte) (int, error) {
	if w.Len()+len(p) > 32772 {
		return 0, io.ErrShortBuffer
	}
	return w.Buffer.Write(p)
}
func (s ExecSigner) Sign(ctx context.Context, in IntentRecord) ([]byte, error) {
	bad := errors.New("external signer failed or returned invalid transaction")
	if !filepath.IsAbs(s.Path) {
		return nil, bad
	}
	body, e := json.Marshal(in.Intent)
	if e != nil || deployment.Hash(body) != in.Digest || in.Intent.Type != "0x2" || in.Intent.Status != "intent_prepared" {
		return nil, bad
	}
	request, e := json.Marshal(struct {
		Version   string       `json:"version"`
		RequestID string       `json:"requestId"`
		Intent    IntentRecord `json:"intent"`
	}{"maintenance-sign-v1", in.Digest, in})
	if e != nil || len(request) > 32768 {
		return nil, bad
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, s.Path)
	cmd.WaitDelay = time.Second
	cmd.Stdin = bytes.NewReader(request)
	cmd.Stderr = io.Discard
	var output boundedSigningOutput
	cmd.Stdout = &output
	if cmd.Run() != nil {
		return nil, bad
	}
	value := strings.TrimSpace(output.String())
	if !strings.HasPrefix(value, "0x") {
		return nil, bad
	}
	raw, e := hex.DecodeString(value[2:])
	if e != nil {
		return nil, bad
	}
	if _, e = ValidateSigned(in, raw); e != nil {
		return nil, bad
	}
	return raw, nil
}
