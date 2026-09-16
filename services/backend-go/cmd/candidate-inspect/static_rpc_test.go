package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

type staticObserver struct {
	mode          string
	calls         int
	hash, genesis string
}

func (f *staticObserver) ChainID(context.Context) (uint64, error) {
	if f.mode == "chain" {
		return 4663, nil
	}
	return 46630, nil
}
func (f *staticObserver) Header(_ context.Context, n string) (chainrpc.Header, error) {
	h := chainrpc.Header{Number: "0xa", Hash: f.hash}
	if n == "0x0" {
		h.Number = "0x0"
		h.Hash = f.genesis
		if f.mode == "genesis" {
			h.Hash = f.hash
		}
		return h, nil
	}
	if n == "finalized" {
		if f.mode == "unfinalized" {
			h.Number = "0x9"
		}
		return h, nil
	}
	f.calls++
	if f.mode == "reorg" && f.calls >= 3 || f.mode == "hash" {
		h.Hash = f.genesis
	}
	if f.mode == "number" {
		h.Number = "0xb"
	}
	return h, nil
}
func (f *staticObserver) CodeAt(_ context.Context, _, hash string) ([]byte, error) {
	if hash != f.hash {
		return nil, errors.New("unpinned call")
	}
	if f.mode == "RPC error" {
		return nil, errors.New("offline")
	}
	if f.mode == "empty code" {
		return nil, nil
	}
	if f.mode == "code mismatch" {
		return []byte{2}, nil
	}
	return []byte{1}, nil
}
func TestStaticCandidateRPC(t *testing.T) {
	for _, mode := range []string{"valid", "chain", "genesis", "unfinalized", "hash", "number", "reorg", "RPC error", "empty code", "code mismatch", "unbound"} {
		t.Run(mode, func(t *testing.T) {
			f := &staticObserver{mode: mode, hash: "0x" + strings.Repeat("1", 64), genesis: "0x" + strings.Repeat("2", 64)}
			m := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 46630, GenesisHash: f.genesis, Contracts: []deployment.Contract{{Module: "OfficialStockRegistryV1", Address: "0x" + strings.Repeat("3", 40), RuntimeCodeHash: deployment.Hash([]byte{1})}}}
			c := readmodel.CandidateSet{ChainID: 46630, BlockNumber: "10", BlockHash: f.hash, EmitterAddressBindingsVerified: mode != "unbound", ProtocolEventInventoryVerified: true}
			if e := verifyStaticCandidate(context.Background(), f, m, c); (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
		})
	}
}
