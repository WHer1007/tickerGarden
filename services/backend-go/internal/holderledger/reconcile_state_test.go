package holderledger

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type stateRPC struct {
	block, genesis chainrpc.Header
	responses      map[string][]byte
	reads, headers int
	reorg, badCode bool
	errHash        bool
}

func abiWords(v ...string) []byte {
	var out []byte
	for _, s := range v {
		base := 10
		if strings.HasPrefix(s, "0x") {
			s = s[2:]
			base = 16
		}
		n, ok := new(big.Int).SetString(s, base)
		if !ok {
			panic(s)
		}
		out = append(out, n.FillBytes(make([]byte, 32))...)
	}
	return out
}
func (f *stateRPC) ChainID(context.Context) (uint64, error) { return 1, nil }
func (f *stateRPC) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	if tag == "0x0" {
		return f.genesis, nil
	}
	if tag == "finalized" {
		return f.block, nil
	}
	if tag != f.block.Number {
		return chainrpc.Header{}, fmt.Errorf("unexpected tag")
	}
	f.headers++
	h := f.block
	if f.reorg && f.headers > 1 {
		h.Hash = f.genesis.Hash
	}
	return h, nil
}
func (f *stateRPC) CodeAt(_ context.Context, _ string, hash string) ([]byte, error) {
	if hash != f.block.Hash {
		f.errHash = true
		return nil, ErrInput
	}
	if f.badCode {
		return []byte{2}, nil
	}
	return []byte{1}, nil
}
func (f *stateRPC) CallAt(_ context.Context, a, data, hash string) ([]byte, error) {
	f.reads++
	if hash != f.block.Hash {
		f.errHash = true
		return nil, ErrInput
	}
	b, ok := f.responses[a+data]
	if !ok {
		return nil, fmt.Errorf("missing fixture %s", data)
	}
	return b, nil
}
func stateCase(t *testing.T) (*Ledger, *stateRPC, ReconcileConfig) {
	t.Helper()
	l, e := New(Registration{MarketID: market, Token: token, Timestamp: 1, TotalSupply: "100", Balances: map[string]string{a: "60", b: "40", zero: "0", token: "0"}, Excluded: []string{zero, token}})
	if e != nil {
		t.Fatal(e)
	}
	if e = l.Apply(Action{Kind: "fund", Timestamp: 1, Amount: "100"}); e != nil {
		t.Fatal(e)
	}
	dist := "0x" + strings.Repeat("3", 40)
	vault := "0x" + strings.Repeat("4", 40)
	f := &stateRPC{responses: map[string][]byte{}, genesis: chainrpc.Header{Number: "0x0", Hash: "0x" + strings.Repeat("a", 64), Timestamp: "0x0", ParentHash: "0x" + strings.Repeat("0", 64)}, block: chainrpc.Header{Number: "0x1", Hash: "0x" + strings.Repeat("b", 64), Timestamp: "0x15181", ParentHash: "0x" + strings.Repeat("a", 64)}}
	c := ReconcileConfig{ChainID: 1, GenesisHash: f.genesis.Hash, Binding: Binding{Distributor: dist, Vault: vault}, Quote: zero, TokenCodeHash: deployment.Hash([]byte{1}), DistributorCodeHash: deployment.Hash([]byte{1}), MaxAccounts: 4}
	set := func(addr, sig, args string, words ...string) {
		f.responses[addr+selector(sig)+args] = abiWords(words...)
	}
	set(token, "treasuryDistributor()", "", dist)
	set(token, "marketId()", "", market)
	set(dist, "rewardMode()", "", deployment.Hash([]byte("TICKERGARDEN_HOLDER_STREAM_24H_V1")))
	set(dist, "STREAM_DURATION()", "", "86400")
	set(dist, "feeSharingExcludedAccounts(bytes32)", market[2:], "32", "2", zero, token)
	rate := new(big.Int).Quo(new(big.Int).Mul(big.NewInt(100), precision), big.NewInt(86400)).String()
	set(dist, "marketState(bytes32)", market[2:], token, zero, vault, "1", "0", "1", "100", "0", "0", rate, "0", "100", "0")
	set(dist, "lastFundingAt(bytes32)", market[2:], "1")
	set(dist, "releaseState(bytes32)", market[2:], "0", "0", "0", "0")
	for addr, amount := range map[string]string{a: "60", b: "40", zero: "0", token: "0"} {
		arg := "000000000000000000000000" + addr[2:]
		set(token, "balanceOf(address)", arg, amount)
		set(dist, "claimable(bytes32,address)", market[2:]+arg, amount)
	}
	set(token, "totalSupply()", "", "100")
	return l, f, c
}
func TestReconcileIndependentState(t *testing.T) {
	for _, kind := range []string{"valid", "wrong-account-allocation", "wrong-code", "wrong-chain", "wrong-genesis", "wrong-block", "reorg", "budget", "cancel", "short-abi", "exclusions", "release", "supply"} {
		t.Run(kind, func(t *testing.T) {
			l, f, c := stateCase(t)
			ctx := context.Background()
			before, _ := l.Bytes(86401)
			modify := func(sig, args string, words ...string) {
				f.responses[c.Binding.Distributor+selector(sig)+args] = abiWords(words...)
			}
			switch kind {
			case "wrong-account-allocation":
				modify("claimable(bytes32,address)", market[2:]+"000000000000000000000000"+a[2:], "59")
				modify("claimable(bytes32,address)", market[2:]+"000000000000000000000000"+b[2:], "41")
			case "wrong-code":
				f.badCode = true
			case "wrong-chain":
				c.ChainID = 2
			case "wrong-genesis":
				c.GenesisHash = f.block.Hash
			case "wrong-block":
				f.block.Number = "0x2"
			case "reorg":
				f.reorg = true
			case "budget":
				c.MaxAccounts = 3
			case "cancel":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			case "short-abi":
				f.responses[c.Binding.Distributor+selector("marketState(bytes32)")+market[2:]] = []byte{0}
			case "exclusions":
				modify("feeSharingExcludedAccounts(bytes32)", market[2:], "32", "2", zero, a)
			case "release":
				modify("releaseState(bytes32)", market[2:], "1", "0", "0", "0")
			case "supply":
				f.responses[token+selector("totalSupply()")] = abiWords("101")
			}
			block := f.block
			if kind == "wrong-block" {
				block.Number = "0x1"
			}
			r, e := l.Reconcile(ctx, f, c, block)
			mismatch := kind == "wrong-account-allocation" || kind == "release" || kind == "supply"
			if kind == "valid" {
				if e != nil || !r.FieldsMatched || r.AccountsChecked != 4 || f.reads < 10 {
					t.Fatalf("valid %+v %v", r, e)
				}
			} else if mismatch {
				if e != nil || r.FieldsMatched || r.DifferenceCount == 0 {
					t.Fatalf("mismatch %+v %v", r, e)
				}
				if kind == "wrong-account-allocation" && r.DifferenceCount != 2 {
					t.Fatal(r)
				}
			} else if e == nil {
				t.Fatalf("accepted %s %+v", kind, r)
			}
			if r.PublicationEligible || f.errHash {
				t.Fatal("publication or hash failure")
			}
			after, _ := l.Bytes(86401)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("reconciliation mutated replay")
			}
		})
	}
}
func TestABIWordFixture(t *testing.T) {
	if hex.EncodeToString(abiWords("1")) != strings.Repeat("0", 63)+"1" {
		t.Fatal("encoding")
	}
}
