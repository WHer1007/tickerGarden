package settlement

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type Signer interface {
	Sign(context.Context, SignRequest) ([]byte, error)
}
type ExecSigner struct{ Path string }
type signingOutput struct{ bytes.Buffer }

func (w *signingOutput) Write(p []byte) (int, error) {
	if w.Len()+len(p) > 32772 {
		return 0, io.ErrShortBuffer
	}
	return w.Buffer.Write(p)
}
func (s ExecSigner) Sign(ctx context.Context, request SignRequest) ([]byte, error) {
	if !filepath.IsAbs(s.Path) || request.Version != "settlement-sign-v1" || request.RequestID != request.Intent.Digest || request.NotAfter <= time.Now().Unix() {
		return nil, ErrIntent
	}
	intentBody, err := json.Marshal(request.Intent.Intent)
	intentSum := sha256.Sum256(intentBody)
	proofSum := sha256.Sum256([]byte(request.EvidenceJSON))
	if err != nil || hex.EncodeToString(intentSum[:]) != request.Intent.Digest || hex.EncodeToString(proofSum[:]) != request.CheckDigest || request.CheckSequence <= 0 || request.NotAfter > request.Intent.Intent.Deadline {
		return nil, ErrIntent
	}
	body, err := json.Marshal(request)
	if err != nil || len(body) > 1<<20 {
		return nil, ErrIntent
	}
	ctx, cancel := context.WithDeadline(ctx, minTime(time.Now().Add(30*time.Second), time.Unix(request.NotAfter, 0)))
	defer cancel()
	cmd := exec.CommandContext(ctx, s.Path)
	cmd.WaitDelay = time.Second
	cmd.Stdin = bytes.NewReader(body)
	cmd.Stderr = io.Discard
	var out signingOutput
	cmd.Stdout = &out
	if cmd.Run() != nil {
		return nil, ErrIntent
	}
	value := strings.TrimSpace(out.String())
	if !strings.HasPrefix(value, "0x") {
		return nil, ErrIntent
	}
	raw, err := hex.DecodeString(value[2:])
	if err != nil {
		return nil, ErrIntent
	}
	if _, err = ValidateSigned(request.Intent, raw); err != nil {
		return nil, err
	}
	return raw, nil
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
