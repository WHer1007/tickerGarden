package deployment

import (
	"context"
	"errors"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

var address = "0x" + strings.Repeat("1", 40)
var blockHash = "0x" + strings.Repeat("2", 64)
var genesisHash = "0x" + strings.Repeat("3", 64)

type observer struct {
	chain         uint64
	genesis, hash string
	code          []byte
	fail          bool
}

func (o observer) ChainID(context.Context) (uint64, error) { return o.chain, nil }
func (o observer) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	h := o.hash
	if tag == "0x0" {
		h = o.genesis
	}
	return chainrpc.Header{Number: tag, Hash: h}, nil
}
func (o observer) CodeAt(_ context.Context, a, h string) ([]byte, error) {
	if o.fail || a != address || h != blockHash {
		return nil, errors.New("injected observation failure")
	}
	return o.code, nil
}
func TestRuntimeIdentityAndBlockScope(t *testing.T) {
	if Hash(nil) != "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" {
		t.Fatal("not Ethereum Keccak-256")
	}
	code := []byte{0x00}
	m := Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 46630, GenesisHash: genesisHash, Contracts: []Contract{{Module: "UserStockVault", Address: address, RuntimeCodeHash: Hash(code)}}}
	good := observer{chain: 46630, genesis: genesisHash, hash: blockHash, code: code}
	block := chainrpc.Header{Number: "0x1", Hash: blockHash}
	v, e := Verify(context.Background(), good, m, block)
	if e != nil {
		t.Fatal(e)
	}
	log := chainrpc.Log{Address: address, BlockHash: blockHash, Topics: []string{Hash([]byte("StockDeposited(bytes32,address,uint256)")), "0x" + strings.Repeat("0", 64), "0x" + strings.Repeat("0", 24) + strings.Repeat("1", 40)}, Data: "0x" + strings.Repeat("0", 63) + "1"}
	decoded, e := v.Decode(46630, log)
	if e != nil || decoded.Args["amount"] != "1" {
		t.Fatal("verified event not decoded", e)
	}
	log.Address = "0x" + strings.Repeat("4", 40)
	if _, e = v.Decode(46630, log); !errors.Is(e, events.ErrUnknown) {
		t.Fatal("unbound emitter accepted")
	}
	log.Address = address
	log.BlockHash = genesisHash
	if _, e = v.Decode(46630, log); e == nil {
		t.Fatal("reused verification across blocks")
	}
	log.BlockHash = blockHash
	if _, e = v.Decode(4663, log); e == nil {
		t.Fatal("reused verification across chains")
	}
	for _, mutate := range []func(*observer){func(o *observer) { o.chain = 4663 }, func(o *observer) { o.genesis = blockHash }, func(o *observer) { o.hash = genesisHash }, func(o *observer) { o.code = nil }, func(o *observer) { o.code = []byte{1} }, func(o *observer) { o.fail = true }} {
		bad := good
		mutate(&bad)
		if _, e := Verify(context.Background(), bad, m, block); e == nil {
			t.Fatal("invalid runtime identity accepted")
		}
	}
	m.Contracts = append(m.Contracts, m.Contracts[0])
	if _, e = Verify(context.Background(), good, m, block); e == nil {
		t.Fatal("duplicate binding accepted")
	}
}

func TestManifestRejectsAmbiguousInput(t *testing.T) {
	for _, raw := range []string{`{"chainId":46630,"chainId":4663}`, `{} {}`, `{"executionSpecId":"V1-EXEC-11","unknown":true}`} {
		if _, e := Parse([]byte(raw)); e == nil {
			t.Fatal("accepted ambiguous manifest")
		}
	}
}
