package chainrpc

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
)

// ReceiptSetCommitment binds the ordered, complete observation to durable storage.
// It detects later row omission or mutation; it is not an Ethereum receipts root
// and does not establish independence from the RPC provider.
func ReceiptSetCommitment(receipts []Receipt) (string, error) {
	if receipts == nil || len(receipts) > 16384 {
		return "", errors.New("invalid receipt set")
	}
	accumulator := NewReceiptSetAccumulator()
	for _, r := range receipts {
		if err := accumulator.Add(r); err != nil {
			return "", err
		}
	}
	return accumulator.Sum(), nil
}

// ReceiptSetAccumulator hashes a single block without retaining its receipts.
// Add errors invalidate the result; callers must abort on any error.
type ReceiptSetAccumulator struct {
	digest       hash.Hash
	total, count int
}

func NewReceiptSetAccumulator() *ReceiptSetAccumulator {
	h := sha256.New()
	h.Write([]byte("tickergarden-receipts-v1\n"))
	return &ReceiptSetAccumulator{digest: h}
}
func (a *ReceiptSetAccumulator) Add(r Receipt) error {
	data, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if a.count >= 16384 || len(data) > (32<<20)-a.total {
		return errors.New("receipt set exceeds budget")
	}
	a.total += len(data)
	a.count++
	a.digest.Write(data)
	a.digest.Write([]byte{'\n'})
	return nil
}
func (a *ReceiptSetAccumulator) Sum() string {
	return "sha256:" + hex.EncodeToString(a.digest.Sum(nil))
}
