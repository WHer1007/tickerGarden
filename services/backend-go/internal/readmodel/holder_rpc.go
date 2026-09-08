package readmodel

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
)

// VerifyHolderEpochRPC checks event-derived FeeVault debts against fresh
// canonical-hash reads. Callers separately authenticate the manifest/runtime,
// candidate provenance, holder configuration and chain identity before/after.
func VerifyHolderEpochRPC(ctx context.Context, rpc deployment.BindingObserver, manifest deployment.Manifest, c CandidateSet) error {
	bad := errors.New("holder epoch event liability RPC mismatch or unavailable")
	if len(c.Markets) == 0 && len(c.HolderMarkets) == 0 {
		return nil
	}
	e := c.FeeReconciliation
	if e == nil || e.Status != "matched" || e.Reason != "" || e.HolderEpochs == nil || e.ChainID != c.ChainID || e.BlockNumber != c.BlockNumber || e.BlockHash != c.BlockHash || e.StartBlock != c.HistoryStartBlock || !c.HasVerifiedHistory() || !c.ProtocolEventInventoryVerified || !c.EmitterAddressBindingsVerified {
		return bad
	}
	report := e.HolderEpochs
	if len(c.HolderMarkets) == 0 {
		if report.Status != "not_applicable" || report.Reason != "" || len(report.Probes) != 0 {
			return bad
		}
		return nil
	}
	if report.Status != "matched" || report.Reason != "" || len(c.HolderMarkets) > 1000 || len(report.Probes) > 2*deployment.MaxHolderEpochReads {
		return bad
	}
	vault := ""
	for _, contract := range manifest.Contracts {
		if contract.Module == "ProtocolFeeVault" {
			if vault != "" {
				return bad
			}
			vault = contract.Address
		}
	}
	if !candidateAddress.MatchString(vault) || vault == "0x"+strings.Repeat("0", 40) {
		return bad
	}
	type target struct{ market, epoch, asset, observed string }
	targets := map[string]target{}
	markets := map[string]MarketReadModel{}
	for _, m := range c.Markets {
		markets[m.MarketID] = m
	}
	for _, h := range c.HolderMarkets {
		m, ok := markets[h.MarketID]
		if !ok || h.MemeToken != m.MemeToken || h.QuoteAsset != m.QuoteAsset || !candidateHash.MatchString(h.MarketID) {
			return bad
		}
		entries := []HolderEpochDetail{}
		switch h.Mode {
		case "epoch":
			if h.Epoch == nil || len(h.Epoch.Entries) == 0 {
				return bad
			}
			entries = h.Epoch.Entries
		case "continuous-24h":
			entries = []HolderEpochDetail{{Epoch: "1"}}
		default:
			return bad
		}
		for _, entry := range entries {
			epoch, err := strconv.ParseUint(entry.Epoch, 10, 32)
			if err != nil || epoch == 0 || strconv.FormatUint(epoch, 10) != entry.Epoch {
				return bad
			}
			for _, pair := range [][2]string{{h.QuoteAsset, "holderQuoteLiability"}, {h.MemeToken, "holderMemeLiability"}} {
				if !candidateAddress.MatchString(pair[0]) {
					return bad
				}
				key := h.MarketID + ":" + entry.Epoch + ":" + pair[0]
				if _, ok := targets[key]; ok || len(targets) >= 2*deployment.MaxHolderEpochReads {
					return bad
				}
				observed := entry.Values[pair[1]]
				if h.Mode == "epoch" && observed == "" {
					return bad
				}
				targets[key] = target{h.MarketID, entry.Epoch, pair[0], observed}
			}
		}
	}
	if len(targets) != len(report.Probes) || len(targets) == 0 {
		return bad
	}
	probes := map[string]EpochLiabilityProbe{}
	for _, p := range report.Probes {
		key := p.MarketID + ":" + p.Epoch + ":" + p.Asset
		t, ok := targets[key]
		if _, dup := probes[key]; dup || !ok || p.Status != "matched" || p.Expected != p.Actual || (t.observed != "" && p.Actual != t.observed) || len(p.Expected) > 78 {
			return bad
		}
		n, ok := new(big.Int).SetString(p.Expected, 10)
		if !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != p.Expected {
			return bad
		}
		probes[key] = p
	}
	keys := make([]string, 0, len(targets))
	for key := range targets {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		t := targets[key]
		epoch, _ := strconv.ParseUint(t.epoch, 10, 32)
		data := deployment.Hash([]byte("holderLiability(bytes32,uint32,address)"))[:10] + t.market[2:] + fmt.Sprintf("%064x", epoch) + strings.Repeat("0", 24) + t.asset[2:]
		raw, err := rpc.CallAt(ctx, vault, data, c.BlockHash)
		if err != nil {
			return bad
		}
		values, err := events.DecodeStatic([]events.Input{{Name: "amount", Type: "uint256"}}, raw)
		if err != nil || values["amount"] != probes[key].Expected {
			return bad
		}
	}
	return nil
}
