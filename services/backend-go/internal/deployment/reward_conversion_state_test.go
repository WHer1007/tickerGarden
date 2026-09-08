package deployment

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
)

// rewardHeaderFixture keeps the timestamp on the final authenticated header;
// discoveryFixture's generic Header helper intentionally omits it.
type rewardHeaderFixture struct {
	*discoveryFixture
	block chainrpc.Header
}

func (f *rewardHeaderFixture) Header(ctx context.Context, tag string) (chainrpc.Header, error) {
	h, err := f.discoveryFixture.Header(ctx, tag)
	if tag == f.block.Number {
		h.Timestamp = f.block.Timestamp
	}
	return h, err
}

func conversionSetup(t *testing.T, enabled bool) (*rewardHeaderFixture, string, string, []ConversionParticipant, map[string]string) {
	t.Helper()
	d, b, id := discoverySetup(t, enabled, true)
	b.Timestamp = fmt.Sprintf("0x%x", time.Now().Unix())
	f := &rewardHeaderFixture{discoveryFixture: d, block: b}
	roots := map[string]string{}
	for _, c := range d.manifest.Contracts {
		roots[c.Module] = c.Address
	}
	roots["CreatorRevenueRegistry"] = "0x" + strings.Repeat("6", 40)
	roots["TickerMemeTokenV1"] = "0x" + strings.Repeat("a", 40)
	roots["MemeStockGauge"] = "0x" + strings.Repeat("c", 40)
	for _, module := range []string{"CreatorRevenueRegistry", "TickerMemeTokenV1", "MemeStockGauge"} {
		if module == "MemeStockGauge" && !enabled {
			continue
		}
		address := roots[module]
		d.code[address] = []byte{1}
		d.manifest.Contracts = append(d.manifest.Contracts, Contract{Module: module, Address: address, RuntimeCodeHash: Hash([]byte{1})})
	}
	operator := "0x" + strings.Repeat("7", 40)
	user := "0x" + strings.Repeat("8", 40)
	set := func(target, sig, args string, values ...string) {
		var raw []byte
		for _, v := range values {
			raw = append(raw, bytesWord(v)...)
		}
		d.calls[target+Hash([]byte(sig))[:10]+args] = raw
	}
	vault, creator, token, gauge := roots["ProtocolFeeVault"], roots["CreatorRevenueRegistry"], roots["TickerMemeTokenV1"], roots["MemeStockGauge"]
	set(vault, "marketRegistry()", "", roots["MarketRegistryV1"])
	set(vault, "creatorRevenueRegistry()", "", creator)
	set(vault, "settlementOperator()", "", operator)
	set(vault, "feePolicyId()", "", wordHex("55"))
	set(creator, "marketRegistry()", "", roots["MarketRegistryV1"])
	set(creator, "factory()", "", roots["TickerGardenFactoryV1"])
	set(token, "factory()", "", roots["TickerGardenFactoryV1"])
	set(token, "marketId()", "", id)
	set(vault, "rawRewardExitAt(bytes32,address)", id[2:]+addressArgument(user), "0")
	epoch := id[2:] + fmt.Sprintf("%064x", 1)
	set(creator, "creatorBeneficiaryAt(bytes32,uint32)", epoch, user)
	set(vault, "creatorLiability(bytes32,uint32,address)", epoch+addressArgument(token), "d")
	if enabled {
		set(gauge, "gaugeIdentity()", "", id, wordHex("bb"), wordHex("22"), roots["AllocationManager"], vault, "0x"+strings.Repeat("d", 40), token)
		set(gauge, "positionOf(address)", addressArgument(user), "6", "4", "5", "64", "7", "9")
		set(roots["AllocationManager"], "rageQuitSettlementPending(bytes32,address)", id[2:]+addressArgument(user), "0", "0")
	}
	return f, id, operator, []ConversionParticipant{{User: user}, {User: user, CreatorEpoch: 1}}, roots
}
func TestRewardConversionStateRolesAndMultipleInstances(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		f, id, operator, people, _ := conversionSetup(t, enabled)
		for i, module := range []string{"TickerMemeTokenV1", "MemeStockGauge"} {
			address := fmt.Sprintf("0x%040x", 100+i)
			f.code[address] = []byte{1}
			f.manifest.Contracts = append(f.manifest.Contracts, Contract{Module: module, Address: address, RuntimeCodeHash: Hash([]byte{1})})
		}
		got, e := ObserveRewardConversionState(context.Background(), f, f.manifest, f.block, operator, id, people)
		if e != nil {
			t.Fatal(e)
		}
		code, codeErr := f.CodeAt(context.Background(), got.FeeVault, f.block.Hash)
		if codeErr != nil || got.FeeVaultRuntimeCodeHash != Hash(code) {
			t.Fatal("FeeVault runtime identity was not preserved")
		}
		if len(got.Participants) != 2 || got.Participants[1].AvailableMeme != "13" || !got.Participants[1].Eligible || got.Participants[0].Eligible != enabled {
			t.Fatalf("bad roles: %+v", got)
		}
		if enabled && got.Participants[0].AvailableMeme != "9" {
			t.Fatal(got)
		}
		if enabled {
			code, err := f.CodeAt(context.Background(), got.Gauge, f.block.Hash)
			if err != nil || got.GaugeRuntimeCodeHash != Hash(code) {
				t.Fatal("Gauge code identity was not preserved")
			}
		} else if got.GaugeRuntimeCodeHash != "" {
			t.Fatal("disabled Gauge identity was invented")
		}
		if !enabled && got.Participants[0].Reason != "staking_disabled" {
			t.Fatal(got)
		}
	}
}
func TestRewardConversionStateExclusions(t *testing.T) {
	for _, kind := range []string{"mature", "future", "pending", "zero"} {
		t.Run(kind, func(t *testing.T) {
			f, id, operator, people, r := conversionSetup(t, true)
			switch kind {
			case "mature", "future":
				stamp, _ := f.block.Time()
				if kind == "future" {
					stamp += 10
				}
				f.calls[r["ProtocolFeeVault"]+Hash([]byte("rawRewardExitAt(bytes32,address)"))[:10]+id[2:]+addressArgument(people[0].User)] = bytesWord(fmt.Sprintf("%x", stamp))
			case "pending":
				f.calls[r["AllocationManager"]+Hash([]byte("rageQuitSettlementPending(bytes32,address)"))[:10]+id[2:]+addressArgument(people[0].User)] = append(bytesWord("1"), bytesWord("7")...)
			case "zero":
				key := r["MemeStockGauge"] + Hash([]byte("positionOf(address)"))[:10] + addressArgument(people[0].User)
				copy(f.calls[key][160:], make([]byte, 32))
			}
			got, e := ObserveRewardConversionState(context.Background(), f, f.manifest, f.block, operator, id, people)
			if e != nil {
				t.Fatal(e)
			}
			switch kind {
			case "mature":
				for _, p := range got.Participants {
					if p.Eligible || p.Reason != "raw_exit_matured" {
						t.Fatal(got)
					}
				}
			case "future":
				for _, p := range got.Participants {
					if !p.Eligible {
						t.Fatal(got)
					}
				}
			case "pending", "zero":
				want := "rage_quit_pending"
				if kind == "zero" {
					want = "no_rewards"
				}
				if got.Participants[0].Eligible || got.Participants[0].Reason != want || !got.Participants[1].Eligible {
					t.Fatal(got)
				}
			}
		})
	}
}
func TestRewardConversionStateRejectsWithoutPartialOutput(t *testing.T) {
	for _, kind := range []string{"stale", "future", "wrong operator", "beneficiary", "identity", "short ABI", "reorg", "chain", "ungraduated", "duplicate", "empty", "zero user", "missing token"} {
		t.Run(kind, func(t *testing.T) {
			f, id, operator, people, r := conversionSetup(t, true)
			switch kind {
			case "stale":
				f.block.Timestamp = "0x64"
			case "future":
				f.block.Timestamp = "0x7fffffffffffffff"
			case "wrong operator":
				operator = people[0].User
			case "beneficiary":
				f.calls[r["CreatorRevenueRegistry"]+Hash([]byte("creatorBeneficiaryAt(bytes32,uint32)"))[:10]+id[2:]+fmt.Sprintf("%064x", 1)] = bytesWord(operator)
			case "identity":
				f.calls[r["MemeStockGauge"]+Hash([]byte("gaugeIdentity()"))[:10]][31] ^= 1
			case "short ABI":
				key := r["ProtocolFeeVault"] + Hash([]byte("creatorLiability(bytes32,uint32,address)"))[:10] + id[2:] + fmt.Sprintf("%064x", 1) + addressArgument(r["TickerMemeTokenV1"])
				f.calls[key] = []byte{1}
			case "reorg":
				f.finalReorg = true
			case "chain":
				f.manifest.ChainID = 4663
			case "ungraduated":
				key := r["MarketRegistryV1"] + Hash([]byte("market(bytes32)"))[:10] + id[2:]
				copy(f.calls[key][19*32:], make([]byte, 32))
			case "duplicate":
				people = append(people, people[0])
			case "empty":
				people = nil
			case "zero user":
				people[0].User = zero20
			case "missing token":
				for i, c := range f.manifest.Contracts {
					if c.Module == "TickerMemeTokenV1" {
						f.manifest.Contracts = append(f.manifest.Contracts[:i], f.manifest.Contracts[i+1:]...)
						break
					}
				}
			}
			got, e := ObserveRewardConversionState(context.Background(), f, f.manifest, f.block, operator, id, people)
			if e == nil || got.MarketID != "" || got.Participants != nil {
				t.Fatalf("accepted %s: %+v %v", kind, got, e)
			}
		})
	}
}
