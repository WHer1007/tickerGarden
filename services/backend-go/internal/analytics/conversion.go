package analytics

import (
	"errors"
	"strings"

	"tickergarden/backend/internal/events"
)

var ErrNotConversionSummary = errors.New("event is not a conversion summary")

type ConversionActivity struct {
	Classification   string `json:"classification"`
	MarketID         string `json:"marketId"`
	BatchNonce       string `json:"batchNonce,omitempty"`
	HolderEpoch      string `json:"holderEpoch,omitempty"`
	MemeAsset        string `json:"memeAsset"`
	QuoteAsset       string `json:"quoteAsset"`
	MemeSpentRaw     string `json:"memeSpentRaw"`
	QuoteReceivedRaw string `json:"quoteReceivedRaw"`
}

// NormalizeConversionSummary consumes authenticated FeeVault summary events.
// RewardConverted is a per-beneficiary allocation, never another execution.
// This labels conversion activity; linking a Pool Swap needs separate evidence.
func NormalizeConversionSummary(event events.Decoded) (ConversionActivity, error) {
	if event.Module != "ProtocolFeeVault" {
		return ConversionActivity{}, ErrNotConversionSummary
	}
	kind, counter := "", ""
	switch event.Signature {
	case "RewardBatchConverted(bytes32,uint256,address,address,uint256,uint256)":
		kind, counter = "internal_reward_conversion", "nonce"
	case "HolderRewardsConverted(bytes32,uint32,address,address,uint256,uint256)":
		kind, counter = "internal_holder_conversion", "epochId"
	default:
		return ConversionActivity{}, ErrNotConversionSummary
	}
	get := func(key string) string { s, _ := event.Args[key].(string); return s }
	market, meme, quote := get("marketId"), get("memeAsset"), get("quoteAsset")
	if !hashRE.MatchString(market) || market == "0x"+strings.Repeat("0", 64) || !addressRE.MatchString(meme) || meme == "0x"+strings.Repeat("0", 40) || !addressRE.MatchString(quote) || meme == quote {
		return ConversionActivity{}, errCurve
	}
	spent, err := uint256(event.Args["memeSpent"])
	if err != nil || spent.Sign() == 0 {
		return ConversionActivity{}, errCurve
	}
	received, err := uint256(event.Args["quoteReceived"])
	if err != nil || received.Sign() == 0 {
		return ConversionActivity{}, errCurve
	}
	n, err := uint256(event.Args[counter])
	if err != nil || (counter == "nonce" && n.Sign() == 0) || (counter == "epochId" && n.BitLen() > 32) {
		return ConversionActivity{}, errCurve
	}
	result := ConversionActivity{Classification: kind, MarketID: market, MemeAsset: meme, QuoteAsset: quote, MemeSpentRaw: spent.String(), QuoteReceivedRaw: received.String()}
	if counter == "nonce" {
		result.BatchNonce = n.String()
	} else {
		result.HolderEpoch = n.String()
	}
	return result, nil
}
