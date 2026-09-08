package treasury

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"time"
)

// RPC fixture exercises the complete service orchestration and hash pinning;
// it is not evidence of a real protocol deployment or receipt-root verification.
type proofRPC struct {
	manifest        deployment.Manifest
	block, source   chainrpc.Header
	calls           map[string][]byte
	reorgAfterGuard bool
	guarded         bool
}

func (r *proofRPC) ChainID(context.Context) (uint64, error) { return r.manifest.ChainID, nil }
func (r *proofRPC) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	if tag == "0x0" {
		return chainrpc.Header{Number: tag, Hash: r.manifest.GenesisHash, Timestamp: "0x0"}, nil
	}
	if tag == r.source.Number {
		return r.source, nil
	}
	b := r.block
	if r.reorgAfterGuard && r.guarded {
		b.Hash = emptyRoot
	}
	return b, nil
}
func (r *proofRPC) CodeAt(_ context.Context, _ string, h string) ([]byte, error) {
	if h != r.block.Hash {
		return nil, errors.New("unpinned code")
	}
	return []byte{0}, nil
}
func (r *proofRPC) CallAt(_ context.Context, address, data, h string) ([]byte, error) {
	if h != r.block.Hash {
		return nil, errors.New("unpinned call")
	}
	if data[:10] == hash([]byte("accountClaimed(bytes32,uint32,address)"))[:10] {
		r.guarded = true
	}
	value, ok := r.calls[address+data]
	if !ok {
		return nil, errors.New("unexpected RPC call")
	}
	return value, nil
}

type proofLookup struct {
	candidate Candidate
	called    bool
	err       error
}

func (l *proofLookup) Find(_ context.Context, chain uint64, market string, epoch uint32, dataset string) (Candidate, error) {
	l.called = true
	if strconv.FormatUint(chain, 10) != l.candidate.Input.ChainID || market != l.candidate.Input.MarketID || epoch != l.candidate.Input.EpochID || dataset != l.candidate.Dataset.DatasetHash {
		return Candidate{}, errors.New("lookup domain mismatch")
	}
	return l.candidate, l.err
}
func serviceFixture(t *testing.T) (*ProofService, *proofRPC, *proofLookup, string, string) {
	t.Helper()
	c, _ := claimFixture(t, 0)
	c.Input.ChainID = "46630"
	c.Input.EligibilityPolicyHash, _ = PolicyHash(c.Input.ChainID, c.Input.MarketID, c.Input.ExcludedAccounts)
	c.Dataset, _ = Generate(c.Input)
	sourceN, _ := strconv.ParseUint(c.Input.SourceBlockNumber, 10, 64)
	sourceT, _ := strconv.ParseUint(c.Input.SourceBlockTimestamp, 10, 64)
	r := &proofRPC{manifest: deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 46630, GenesisHash: hash([]byte("genesis"))}, calls: map[string][]byte{}, block: chainrpc.Header{Number: fmt.Sprintf("0x%x", sourceN+1), Hash: hash([]byte("latest")), Timestamp: fmt.Sprintf("0x%x", sourceT+100)}, source: chainrpc.Header{Number: fmt.Sprintf("0x%x", sourceN), Hash: c.Input.SourceBlockHash, Timestamp: fmt.Sprintf("0x%x", sourceT)}}
	modules := []string{"TickerGardenFactoryV1", "OfficialStockRegistryV1", "ApprovedQuoteRegistry", "TickerGardenBaselineRegistry", "LaunchTemplateRegistry", "MarketRegistryV1", "ProtocolFeeVault", "AllocationManager", "LaunchAndBuyRouter", "TreasuryDistributorV1"}
	roots := map[string]string{}
	for i, m := range modules {
		a := fmt.Sprintf("0x%040x", i+100)
		if m == "TreasuryDistributorV1" {
			a = c.Input.Distributor
		}
		roots[m] = a
		r.manifest.Contracts = append(r.manifest.Contracts, deployment.Contract{Module: m, Address: a, RuntimeCodeHash: hash([]byte{0})})
	}
	set := func(module, sig, args string, words ...[]byte) {
		var b []byte
		for _, w := range words {
			b = append(b, w...)
		}
		r.calls[roots[module]+hash([]byte(sig))[:10]+args] = b
	}
	var binding [][]byte
	for _, m := range modules[1:9] {
		binding = append(binding, hexWord(roots[m]))
	}
	set(modules[0], "runtimeBindings()", "", binding...)
	for _, edge := range [][3]string{{"MarketRegistryV1", "factory()", modules[0]}, {"MarketRegistryV1", "officialStockRegistry()", modules[1]}, {"MarketRegistryV1", "approvedQuoteRegistry()", modules[2]}, {"MarketRegistryV1", "tickerGardenBaselineRegistry()", modules[3]}, {"MarketRegistryV1", "launchTemplateRegistry()", modules[4]}, {modules[2], "officialStockRegistry()", modules[1]}, {modules[0], "treasuryDistributor()", modules[9]}, {modules[9], "marketRegistry()", modules[5]}} {
		set(edge[0], edge[1], "", hexWord(roots[edge[2]]))
	}
	fields := make([][]byte, 20)
	for i := range fields {
		fields[i] = uintWord(0)
	}
	fields[9] = hexWord(c.Input.MemeToken)
	fields[12] = hexWord(c.Input.QuoteToken)
	set(modules[5], "market(bytes32)", c.Input.MarketID[2:], fields...)
	d := modules[9]
	args := c.Input.MarketID[2:] + fmt.Sprintf("%064x", c.Input.EpochID)
	set(d, "market(bytes32)", c.Input.MarketID[2:], hexWord(c.Input.MemeToken), hexWord(c.Input.QuoteToken), hexWord(c.Input.EligibilityPolicyHash), uintWord(1))
	num := func(s string) []byte { v, _ := integer(s, 256); return word(v) }
	set(d, "epoch(bytes32,uint32)", args, uintWord(sourceT+10), uintWord(sourceT+20), uintWord(sourceT+50), uintWord(sourceT+150), uintWord(sourceN), uintWord(uint64(c.Dataset.LeafCount)), uintWord(3), hexWord(c.Input.Distributor), hexWord(zero), uintWord(0), hexWord(c.Input.SourceBlockHash), hexWord(c.Dataset.MerkleRoot), hexWord(c.Dataset.DatasetHash), num(c.Input.QuoteAmount), uintWord(0), num(c.Dataset.TotalTwab))
	set(d, "epochQuoteAmount(bytes32,uint32)", args, num(c.Input.QuoteAmount))
	set(d, "epochWindow(bytes32,uint32)", args, num(c.Input.WindowStart), num(c.Input.WindowEnd))
	set(d, "EPOCH_DURATION()", "", uintWord(Duration))
	set(d, "TWAB_SCHEMA()", "", hexWord(twabSchema))
	leaf := c.Dataset.Leaves[0]
	bitmap := roots[d] + hash([]byte("isClaimed(bytes32,uint32,uint256)"))[:10] + args + fmt.Sprintf("%064x", leaf.Index)
	account := roots[d] + hash([]byte("accountClaimed(bytes32,uint32,address)"))[:10] + args + fmt.Sprintf("%064s", leaf.Account[2:])
	r.calls[bitmap] = uintWord(0)
	r.calls[account] = uintWord(0)
	lookup := &proofLookup{candidate: c}
	s := NewProofService(r, r.manifest, lookup)
	s.now = func() time.Time { return time.Unix(int64(sourceT+100), 0) }
	return s, r, lookup, bitmap, account
}
func TestProofServiceFullQuery(t *testing.T) {
	for _, name := range []string{"valid", "bitmap", "account", "claimed exhausted", "missing", "late reorg", "stale", "cancelled", "RPC failure"} {
		t.Run(name, func(t *testing.T) {
			service, r, lookup, bitmap, accountKey := serviceFixture(t)
			c := lookup.candidate
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch name {
			case "bitmap":
				r.calls[bitmap] = uintWord(1)
			case "account":
				r.calls[accountKey] = uintWord(1)
			case "claimed exhausted":
				r.calls[bitmap] = uintWord(1)
				key := c.Input.Distributor + hash([]byte("epoch(bytes32,uint32)"))[:10] + c.Input.MarketID[2:] + fmt.Sprintf("%064x", c.Input.EpochID)
				amount, _ := integer(c.Input.QuoteAmount, 256)
				copy(r.calls[key][14*32:15*32], word(amount))
			case "missing":
				lookup.err = ErrProofNotFound
			case "late reorg":
				r.reorgAfterGuard = true
			case "stale":
				service.now = func() time.Time { return time.Unix(9999999999, 0) }
			case "cancelled":
				cancel()
			case "RPC failure":
				delete(r.calls, accountKey)
			}
			got, err := service.ClaimProof(ctx, c.Input.MarketID, c.Input.EpochID, c.Dataset.Leaves[0].Account)
			if name == "valid" {
				if err != nil || got.Amount != c.Input.QuoteAmount || !lookup.called {
					t.Fatal(got, err)
				}
				return
			}
			if err == nil || got.Schema != "" {
				t.Fatal("unsafe query succeeded", got, err)
			}
			if name == "bitmap" || name == "account" || name == "claimed exhausted" {
				if !errors.Is(err, ErrProofClaimed) {
					t.Fatal("claim status lost", err)
				}
			}
			if name == "stale" && lookup.called {
				t.Fatal("stale RPC reached store")
			}
		})
	}
}
