package analytics

import (
	"errors"
	"strings"

	"tickergarden/backend/internal/events"
)

var ErrConversionLink = errors.New("conversion transaction evidence is inconsistent")

// ConversionLog must come from a complete, canonical, receipt-verified transaction
// after module/emitter authentication. Arbitrary client-supplied logs are unsafe.
type ConversionLog struct {
	Source CurveSource
	Event  events.Decoded
}

// ConversionBinding is authenticated against the protocol deployment and PoolKey.
type ConversionBinding struct {
	Pool        PoolBinding
	Hook        string
	FeeVault    string
	PoolManager string
}

type ConversionLink struct {
	SwapSource    CurveSource        `json:"swapSource"`
	SummarySource CurveSource        `json:"summarySource"`
	Activity      ConversionActivity `json:"activity"`
	FeeTreatment  string             `json:"feeTreatment"`
}

// LinkConversionSwaps links each Hook-initiated sell to exactly one subsequent
// FeeVault summary. Ordinary router swaps and per-user allocations are excluded.
// Hook self-calls bypass v4 before/afterSwap (Hooks.sol), so core deltas equal
// the spent/received amounts. This is not a general no-fee inference.
func LinkConversionSwaps(logs []ConversionLog, bindings []ConversionBinding) ([]ConversionLink, error) {
	fail := func() ([]ConversionLink, error) { return nil, ErrConversionLink }
	if len(logs) > 10000 || len(bindings) > 1024 {
		return fail()
	}
	byPool := map[string]ConversionBinding{}
	byMarket := map[string]ConversionBinding{}
	for _, b := range bindings {
		if !hashRE.MatchString(b.Pool.MarketID) || !hashRE.MatchString(b.Pool.PoolID) {
			return fail()
		}
		for _, a := range []string{b.Hook, b.FeeVault, b.PoolManager} {
			if !addressRE.MatchString(a) || a == "0x"+strings.Repeat("0", 40) {
				return fail()
			}
		}
		if _, ok := byPool[b.Pool.PoolID]; ok {
			return fail()
		}
		if _, ok := byMarket[b.Pool.MarketID]; ok {
			return fail()
		}
		byPool[b.Pool.PoolID] = b
		byMarket[b.Pool.MarketID] = b
	}
	pending := map[string]ConversionLog{}
	lastSwap := map[string]uint64{}
	out := []ConversionLink{}
	for i, l := range logs {
		if !validSource(l.Source, l.Source.ChainID, l.Source.EventKey) {
			return fail()
		}
		if i > 0 {
			first, prev := logs[0].Source, logs[i-1].Source
			if l.Source.ChainID != first.ChainID || l.Source.BlockHash != first.BlockHash || l.Source.BlockNumber != first.BlockNumber || l.Source.TransactionHash != first.TransactionHash || l.Source.TransactionIndex != first.TransactionIndex || l.Source.LogIndex <= prev.LogIndex {
				return fail()
			}
		}
		e := l.Event
		if e.Module == "UniswapV4PoolManager" && e.Signature == "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)" {
			id, _ := e.Args["id"].(string)
			b, ok := byPool[id]
			if !ok {
				continue
			}
			if l.Source.Emitter != b.PoolManager {
				return fail()
			}
			lastSwap[id] = l.Source.LogIndex
			if e.Args["sender"] != b.Hook {
				continue
			}
			a, err := NormalizePoolAmounts(e, nil, b.Pool)
			if err != nil || a.Side != "sell" {
				return fail()
			}
			if _, exists := pending[b.Pool.MarketID]; exists {
				return fail()
			}
			pending[b.Pool.MarketID] = l
			continue
		}
		if e.Module == "TickerGardenMemeHook" && e.Signature == "V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)" {
			// A normal router swap may occur between conversion and summary. Only a
			// fee immediately attributable to the pending Hook swap contradicts it.
			id, _ := e.Args["poolId"].(string)
			if b, ok := byPool[id]; ok {
				if p, exists := pending[b.Pool.MarketID]; exists {
					last := lastSwap[id]
					if last == p.Source.LogIndex {
						return fail()
					}
				}
			}
		}
		a, err := NormalizeConversionSummary(e)
		if errors.Is(err, ErrNotConversionSummary) {
			continue
		}
		if err != nil {
			return fail()
		}
		b, ok := byMarket[a.MarketID]
		if !ok {
			return fail()
		}
		p, ok := pending[a.MarketID]
		if !ok || l.Source.Emitter != b.FeeVault || a.MemeAsset != b.Pool.MemeAsset || a.QuoteAsset != b.Pool.QuoteAsset {
			return fail()
		}
		amounts, err := NormalizePoolAmounts(p.Event, nil, b.Pool)
		if err != nil || amounts.MemeCoreRaw != a.MemeSpentRaw || amounts.QuoteCoreRaw != a.QuoteReceivedRaw {
			return fail()
		}
		out = append(out, ConversionLink{SwapSource: p.Source, SummarySource: l.Source, Activity: a, FeeTreatment: "hook_self_call_bypasses_callbacks"})
		delete(pending, a.MarketID)
	}
	if len(pending) != 0 {
		return fail()
	}
	return out, nil
}
