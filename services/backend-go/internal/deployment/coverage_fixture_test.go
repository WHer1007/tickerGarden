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

func conversionSetup(t *testing.T, enabled bool) (*rewardHeaderFixture, string, map[string]string) {
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
	set(vault, "feePolicyId()", "", wordHex("55"))
	set(creator, "marketRegistry()", "", roots["MarketRegistryV1"])
	set(creator, "factory()", "", roots["TickerGardenFactoryV1"])
	set(token, "factory()", "", roots["TickerGardenFactoryV1"])
	set(token, "marketId()", "", id)
	epoch := id[2:] + fmt.Sprintf("%064x", 1)
	set(creator, "creatorBeneficiaryAt(bytes32,uint32)", epoch, user)
	set(vault, "creatorLiability(bytes32,uint32,address)", epoch+addressArgument(token), "d")
	if enabled {
		set(gauge, "gaugeIdentity()", "", id, wordHex("bb"), wordHex("22"), roots["AllocationManager"], vault, "0x"+strings.Repeat("d", 40), token)
		set(gauge, "positionOf(address)", addressArgument(user), "6", "4", "5", "64", "7", "9")
		set(roots["AllocationManager"], "rageQuitSettlementPending(bytes32,address)", id[2:]+addressArgument(user), "0", "0")
	}
	return f, id, roots
}
