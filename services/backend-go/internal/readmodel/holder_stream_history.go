package readmodel

import (
	"errors"
	"math/big"
	"strconv"
	"strings"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

type holderStreamKey struct{ distributor, market string }
type holderStreamTotals struct {
	funded, paid *big.Int
	registered   bool
	token, quote string
	asset        string
	lastFunding  uint64
}
type holderStreamHistory struct {
	totals map[holderStreamKey]*holderStreamTotals
	count  int
}

func newHolderStreamHistory() *holderStreamHistory {
	return &holderStreamHistory{totals: map[holderStreamKey]*holderStreamTotals{}}
}
func (h *holderStreamHistory) add(input projection.Input, blockTimestamp uint64) error {
	if input.Module != "HolderRewardsDistributorV1" {
		return nil
	}
	d, e := events.Decode(input.Module, input.Log)
	if e != nil {
		return e
	}
	funded := strings.HasPrefix(d.Signature, "HolderStreamFunded(")
	registered := strings.HasPrefix(d.Signature, "HolderStreamMarketRegistered(")
	if !registered && !funded && !strings.HasPrefix(d.Signature, "HolderStreamClaimed(") {
		return nil
	}
	bad := errors.New("invalid continuous Holder history")
	h.count++
	if h.count > 100000 {
		return bad
	}
	get := func(k string) string { s, _ := d.Args[k].(string); return s }
	key := holderStreamKey{d.Emitter, get("marketId")}
	total := h.totals[key]
	if total == nil {
		total = &holderStreamTotals{funded: new(big.Int), paid: new(big.Int)}
		h.totals[key] = total
	}
	if registered {
		zero := "0x0000000000000000000000000000000000000000"
		if total.registered || get("marketId") == "0x0000000000000000000000000000000000000000000000000000000000000000" || get("token") == zero || get("vault") == zero || get("token") == get("quote") {
			return bad
		}
		total.registered = true
		total.token = get("token")
		total.quote = get("quote")
		return nil
	}
	if !total.registered {
		return bad
	}
	amount, e := raw(get("amount"))
	if e != nil || amount.Sign() == 0 {
		return bad
	}
	if funded {
		end, e := strconv.ParseUint(get("end"), 10, 64)
		if e != nil || end < 86400 || end-86400 != blockTimestamp || end-86400 < total.lastFunding {
			return bad
		}
		total.lastFunding = end - 86400
		total.funded.Add(total.funded, amount)
		if total.funded.BitLen() > 128 {
			return bad
		}
	} else {
		asset := get("asset")
		if asset != total.quote || get("account") == "0x0000000000000000000000000000000000000000" || (total.asset != "" && total.asset != asset) {
			return bad
		}
		total.asset = asset
		total.paid.Add(total.paid, amount)
		if total.paid.Cmp(total.funded) > 0 {
			return bad
		}
	}
	return nil
}
func (h *holderStreamHistory) verify(holders []HolderMarketCandidate) error {
	bad := errors.New("continuous Holder totals differ from receipt history")
	markets := map[string]bool{}
	matched := map[holderStreamKey]bool{}
	for _, holder := range holders {
		if holder.Mode != "continuous-24h" {
			continue
		}
		if holder.Continuous == nil {
			return bad
		}
		markets[holder.MarketID] = true
		key := holderStreamKey{holder.Distributor, holder.MarketID}
		total := h.totals[key]
		if total == nil || !total.registered || total.token != holder.MemeToken || total.quote != holder.QuoteAsset {
			return bad
		}
		if total.funded.String() != holder.Continuous.Funded || total.paid.String() != holder.Continuous.Paid || strconv.FormatUint(total.lastFunding, 10) != holder.Continuous.LastFundingAt || (total.asset != "" && total.asset != holder.QuoteAsset) {
			return bad
		}
		matched[key] = true
	}
	for key := range h.totals {
		if markets[key.market] && !matched[key] {
			return bad
		}
	}
	return nil
}
