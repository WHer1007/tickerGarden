package analytics

import (
	"context"
	"errors"
	"math/big"
	"strconv"
	"time"

	"tickergarden/backend/internal/displayprice"
)

var ErrMarketMetrics = errors.New("market ranking metrics unavailable")

const (
	marketVolumeBasis = "EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE"
	marketCapBasis    = "BASELINE_TOTAL_SUPPLY_X_LATEST_FINALIZED_24H_EXECUTION_PRICE"
)

type MarketMetricMarket struct {
	MarketID, QuoteAsset, TickerGardenBaselineID string
}

type MarketMetricConfig struct {
	Kind, ID, Supply string
}

type MarketMetricSnapshot struct {
	BlockNumber, BlockHash, Revision string
	Markets                          []MarketMetricMarket
	Configs                          []MarketMetricConfig
}

type MarketMetric struct {
	Status              string
	Reason              string
	Volume24hUSD        *string
	MarketCapUSD        *string
	QuoteUSDMidpoint    *string
	WindowFromTimestamp string
	AsOfTimestamp       string
	USDPriceAsOf        *string
	USDPriceSource      *string
	VolumeBasis         string
	MarketCapBasis      string
}

// MarketMetrics builds a complete directory metric set at the published
// snapshot block. USD references are used only when a single fresh reference
// matches the market Quote Token address exactly.
func (s *CandleStore) MarketMetrics(ctx context.Context, snap MarketMetricSnapshot, refs []displayprice.Reference) (map[string]*MarketMetric, error) {
	if s == nil || s.pool == nil || snap.BlockHash == "" || snap.BlockNumber == "" || snap.Revision == "" {
		return nil, ErrMarketMetrics
	}
	block, err := strconv.ParseUint(snap.BlockNumber, 10, 63)
	if err != nil || strconv.FormatUint(block, 10) != snap.BlockNumber {
		return nil, ErrMarketMetrics
	}
	var observed uint64
	if err = s.pool.QueryRow(ctx, `SELECT block_timestamp FROM tickergarden.chain_blocks WHERE chain_id=$1 AND number=$2 AND hash=$3 AND canonical=true`, s.manifest.ChainID, block, snap.BlockHash).Scan(&observed); err != nil || observed <= 86400 {
		return nil, ErrMarketMetrics
	}
	// The snapshot block is the right-side coverage anchor. Keeping To equal to
	// its timestamp makes the full interval provable without reading past the
	// requested finalized revision.
	to := observed
	from := to - 86400
	_, inputs, err := loadGlobalSnapshot(ctx, s.pool, s.manifest, from, to)
	if err != nil || len(inputs) != len(snap.Markets) {
		return nil, ErrMarketMetrics
	}

	supplies := map[string]*big.Int{}
	for _, config := range snap.Configs {
		if config.Kind != "baseline" {
			continue
		}
		raw := config.Supply
		if raw == "" {
			continue
		}
		value, ok := new(big.Int).SetString(raw, 10)
		if ok && value.Sign() > 0 {
			supplies[config.ID] = value
		}
	}
	prices := uniqueQuotePrices(refs, s.manifest.ChainID)
	trades := make(map[string]MarketTrades, len(inputs))
	for _, input := range inputs {
		trades[input.Trades.MarketID] = input.Trades
	}

	out := make(map[string]*MarketMetric, len(snap.Markets))
	for _, market := range snap.Markets {
		metric := &MarketMetric{
			Status: "unavailable", Reason: "usd_reference_unavailable",
			WindowFromTimestamp: strconv.FormatUint(from, 10), AsOfTimestamp: strconv.FormatUint(observed, 10),
			VolumeBasis: marketVolumeBasis, MarketCapBasis: marketCapBasis,
		}
		data, ok := trades[market.MarketID]
		price, priced := prices[market.QuoteAsset]
		if !ok || !priced || data.QuoteAsset != market.QuoteAsset {
			out[market.MarketID] = metric
			continue
		}
		midpoint := new(big.Rat).Add(price.bid, price.ask)
		midpoint.Quo(midpoint, big.NewRat(2, 1))
		midpointText := decimal18(midpoint)
		asOf, source := price.asOf.UTC().Format(time.RFC3339), price.source
		metric.QuoteUSDMidpoint, metric.USDPriceAsOf, metric.USDPriceSource = &midpointText, &asOf, &source
		volume := new(big.Int)
		for _, trade := range data.Items {
			if trade.Classification != "unclassified" {
				continue
			}
			value, ok := new(big.Int).SetString(trade.QuoteRaw, 10)
			if !ok || value.Sign() <= 0 {
				return nil, ErrMarketMetrics
			}
			volume.Add(volume, value)
		}
		volumeUSD := new(big.Rat).Mul(new(big.Rat).SetInt(volume), midpoint)
		volumeUSD.Quo(volumeUSD, new(big.Rat).SetInt(pow10(data.QuoteDecimals)))
		volumeText := decimal18(volumeUSD)
		metric.Volume24hUSD = &volumeText
		metric.Status, metric.Reason = "available", ""

		supply := supplies[market.TickerGardenBaselineID]
		if len(data.Items) == 0 || supply == nil {
			metric.Reason = "market_cap_price_unavailable"
			out[market.MarketID] = metric
			continue
		}
		latest := data.Items[0]
		numerator, nOK := new(big.Int).SetString(latest.Price.Numerator, 10)
		denominator, dOK := new(big.Int).SetString(latest.Price.Denominator, 10)
		if !nOK || !dOK || numerator.Sign() <= 0 || denominator.Sign() <= 0 {
			return nil, ErrMarketMetrics
		}
		capUSD := new(big.Rat).SetFrac(numerator, denominator)
		capUSD.Mul(capUSD, new(big.Rat).SetInt(supply))
		capUSD.Quo(capUSD, new(big.Rat).SetInt(pow10(18)))
		capUSD.Mul(capUSD, midpoint)
		capText := decimal18(capUSD)
		metric.MarketCapUSD = &capText
		out[market.MarketID] = metric
	}
	return out, nil
}

type quoteUSD struct {
	bid, ask *big.Rat
	asOf     time.Time
	source   string
}

func uniqueQuotePrices(refs []displayprice.Reference, chainID uint64) map[string]quoteUSD {
	out := map[string]quoteUSD{}
	duplicates := map[string]bool{}
	for _, ref := range refs {
		if ref.ChainID != chainID || ref.Status != "available" || ref.Unit != "USD_PER_WHOLE_TOKEN" || ref.Source != displayprice.Source || ref.BidUSD == nil || ref.AskUSD == nil || ref.AsOf == nil || ref.ExpiresAt == nil || duplicates[ref.Token] {
			continue
		}
		bid, bidOK := new(big.Rat).SetString(*ref.BidUSD)
		ask, askOK := new(big.Rat).SetString(*ref.AskUSD)
		if !bidOK || !askOK || bid.Sign() <= 0 || ask.Sign() <= 0 || bid.Cmp(ask) > 0 {
			continue
		}
		if _, exists := out[ref.Token]; exists {
			delete(out, ref.Token)
			duplicates[ref.Token] = true
			continue
		}
		out[ref.Token] = quoteUSD{bid: bid, ask: ask, asOf: *ref.AsOf, source: ref.Source}
	}
	return out
}

func pow10(decimals uint8) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
}

func decimal18(value *big.Rat) string {
	if value == nil || value.Sign() < 0 {
		return "0"
	}
	scaled := new(big.Int).Quo(new(big.Int).Mul(value.Num(), pow10(18)), value.Denom())
	digits := scaled.String()
	if len(digits) <= 18 {
		digits = "000000000000000000"[:18-len(digits)+1] + digits
	}
	integer, fraction := digits[:len(digits)-18], digits[len(digits)-18:]
	for len(fraction) > 0 && fraction[len(fraction)-1] == '0' {
		fraction = fraction[:len(fraction)-1]
	}
	if fraction == "" {
		return integer
	}
	return integer + "." + fraction
}
