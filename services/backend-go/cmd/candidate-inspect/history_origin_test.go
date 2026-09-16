package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

type originObserver struct {
	mode         string
	reads, codes int
}

func (o *originObserver) ChainID(context.Context) (uint64, error) { return 46630, nil }
func originHash(n int) string                                     { return fmt.Sprintf("0x%064x", n) }
func (o *originObserver) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	o.reads++
	if o.mode == "offline" {
		return chainrpc.Header{}, errors.New("offline")
	}
	n := 1
	if tag == "0x0" {
		n = 0
	}
	h := chainrpc.Header{Number: tag, Hash: originHash(n + 1), ParentHash: originHash(n)}
	if o.mode == "start mismatch" && n == 1 {
		h.Hash = originHash(9)
	}
	if o.mode == "parent mismatch" && n == 0 {
		h.Hash = originHash(9)
	}
	if o.mode == "reorg" && o.reads >= 3 {
		h.Hash = originHash(9)
	}
	return h, nil
}
func (o *originObserver) CodeAt(_ context.Context, address, hash string) ([]byte, error) {
	o.codes++
	if hash != originHash(1) {
		return nil, errors.New("unpinned origin")
	}
	if o.mode == "pruned" {
		return nil, errors.New("historical state unavailable")
	}
	if o.mode == "existing" || o.mode == "second exists" && strings.HasSuffix(address, "2") {
		return []byte{1}, nil
	}
	return []byte{}, nil
}
func TestHistoryOrigin(t *testing.T) {
	for _, mode := range []string{"valid", "genesis", "missing roots", "start mismatch", "parent mismatch", "reorg", "offline", "pruned", "existing", "second exists"} {
		t.Run(mode, func(t *testing.T) {
			o := &originObserver{mode: mode}
			m := deployment.Manifest{ChainID: 46630, GenesisHash: originHash(1), Contracts: []deployment.Contract{{Address: "0x" + strings.Repeat("0", 39) + "1"}, {Address: "0x" + strings.Repeat("0", 39) + "2"}}}
			c := readmodel.CandidateSet{ChainID: 46630, BlockNumber: "3", HistoryStartBlock: 1, HistoryStartHash: originHash(2), HistoryReceiptRootsVerified: true}
			if mode == "missing roots" {
				c.HistoryReceiptRootsVerified = false
			}
			if mode == "genesis" {
				c.HistoryStartBlock = 0
				c.HistoryStartHash = m.GenesisHash
			}
			err := verifyHistoryOrigin(context.Background(), o, m, c)
			valid := mode == "valid" || mode == "genesis"
			if (err == nil) != valid {
				t.Fatal(mode, err)
			}
			if mode == "valid" && o.codes != 2 {
				t.Fatal("omitted manifest address")
			}
			if mode == "genesis" && o.codes != 0 {
				t.Fatal("genesis underflow")
			}
		})
	}
}
