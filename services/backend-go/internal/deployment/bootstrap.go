package deployment

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"tickergarden/backend/internal/chainrpc"
)

const MaxBootstrapBytes = 128 << 20

// VerifyBootstrap authenticates hash-committed receipt or header-exclusion evidence, not an
// operator assertion that the initialization interval was business-free.
// The caller must supply the real canonical business-start header to each RPC.
func VerifyBootstrap(ctx context.Context, rpc Observer, m Manifest, start chainrpc.Header, raw []byte) error {
	bad := errors.New("deployment bootstrap history unavailable or contains omitted protocol activity")
	b := m.Bootstrap
	if rpc == nil || validate(m) != nil || b == nil || len(raw) == 0 || len(raw) > MaxBootstrapBytes || Hash(raw) != b.EvidenceHash || start.Number != fmt.Sprintf("0x%x", b.BusinessStartBlock) || start.Hash != b.BusinessStartHash {
		return fmt.Errorf("%w: scope or evidence commitment", bad)
	}
	if unique(json.NewDecoder(bytes.NewReader(raw)), 0) != nil {
		return fmt.Errorf("%w: duplicate JSON", bad)
	}
	var bundles []chainrpc.ReceiptRootBundle
	if json.Unmarshal(raw, &bundles) != nil || uint64(len(bundles)) != b.BusinessStartBlock-b.DeploymentStartBlock {
		return fmt.Errorf("%w: bundle count", bad)
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != m.ChainID {
		return fmt.Errorf("%w: chain identity", bad)
	}
	genesis, e := rpc.Header(ctx, "0x0")
	if e != nil || genesis.Hash != m.GenesisHash {
		return fmt.Errorf("%w: genesis identity", bad)
	}
	parent, e := rpc.Header(ctx, fmt.Sprintf("0x%x", b.DeploymentStartBlock-1))
	if e != nil || parent.Number != fmt.Sprintf("0x%x", b.DeploymentStartBlock-1) {
		return fmt.Errorf("%w: deployment parent", bad)
	}
	protocol := map[string]bool{}
	for _, c := range m.Contracts {
		code, err := rpc.CodeAt(ctx, c.Address, parent.Hash)
		if err != nil {
			return fmt.Errorf("%w: parent code read", bad)
		}
		if c.Module == "UniswapV4PoolManager" {
			if len(code) == 0 || Hash(code) != c.RuntimeCodeHash {
				return fmt.Errorf("%w: external dependency fingerprint", bad)
			}
		} else {
			if len(code) != 0 {
				return fmt.Errorf("%w: preexisting protocol runtime", bad)
			}
			protocol[c.Address] = true
		}
		code, err = rpc.CodeAt(ctx, c.Address, start.Hash)
		if err != nil || len(code) == 0 || Hash(code) != c.RuntimeCodeHash {
			return fmt.Errorf("%w: business-start code identity", bad)
		}
	}
	previous := parent.Hash
	emitters := make([]string, 0, len(protocol))
	for address := range protocol {
		emitters = append(emitters, address)
	}
	for i, bundle := range bundles {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var h struct {
			Number     string `json:"number"`
			Hash       string `json:"hash"`
			ParentHash string `json:"parentHash"`
		}
		if json.Unmarshal(bundle.Header, &h) != nil || h.Number != fmt.Sprintf("0x%x", b.DeploymentStartBlock+uint64(i)) || h.ParentHash != previous || (i == 0 && h.Hash != b.DeploymentStartHash) {
			return fmt.Errorf("%w: bootstrap ancestry", bad)
		}
		if bundle.Receipts == nil {
			if err := chainrpc.VerifyEventExclusion(bundle.Header, h.Hash, emitters); err != nil {
				return fmt.Errorf("%w: bootstrap event exclusion", bad)
			}
		} else if _, err := chainrpc.VerifyReceiptRootBundle(bundle.Header, bundle.Receipts, h.Hash); err != nil {
			return fmt.Errorf("%w: bootstrap receipt root", bad)
		}
		for _, r := range bundle.Receipts {
			var receipt chainrpc.Receipt
			if json.Unmarshal(r, &receipt) != nil {
				return fmt.Errorf("%w: receipt encoding", bad)
			}
			for _, log := range receipt.Logs {
				if protocol[strings.ToLower(log.Address)] {
					return fmt.Errorf("%w: omitted protocol event", bad)
				}
			}
		}
		previous = h.Hash
	}
	if previous != start.ParentHash {
		return fmt.Errorf("%w: business-start ancestry", bad)
	}
	// Hash-linked headers bind every omitted block to the canonical start. The
	// second endpoint independently authenticates that anchor and code identities.
	again, e := rpc.Header(ctx, start.Number)
	if e != nil || again.Hash != start.Hash || again.ParentHash != start.ParentHash {
		return fmt.Errorf("%w: business canonical fence", bad)
	}
	again, e = rpc.Header(ctx, parent.Number)
	if e != nil || again.Hash != parent.Hash {
		return fmt.Errorf("%w: deployment canonical fence", bad)
	}
	return nil
}
