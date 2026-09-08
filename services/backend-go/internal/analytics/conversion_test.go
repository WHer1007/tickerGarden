package analytics

import (
	"errors"
	"strings"
	"testing"
	"tickergarden/backend/internal/events"
)

func conversionEvent(holder bool) events.Decoded {
	sig := "RewardBatchConverted(bytes32,uint256,address,address,uint256,uint256)"
	if holder {
		sig = "HolderRewardsConverted(bytes32,uint32,address,address,uint256,uint256)"
	}
	return events.Decoded{Module: "ProtocolFeeVault", Signature: sig, Args: map[string]any{"marketId": "0x" + strings.Repeat("1", 64), "memeAsset": "0x" + strings.Repeat("2", 40), "quoteAsset": "0x" + strings.Repeat("0", 40), "memeSpent": "9007199254740993", "quoteReceived": "101", "nonce": "1", "epochId": "0"}}
}
func TestConversionSummaryClassification(t *testing.T) {
	for _, holder := range []bool{false, true} {
		e := conversionEvent(holder)
		got, err := NormalizeConversionSummary(e)
		if err != nil || got.MemeSpentRaw != "9007199254740993" || got.QuoteReceivedRaw != "101" {
			t.Fatalf("%+v %v", got, err)
		}
		if holder {
			if got.Classification != "internal_holder_conversion" || got.HolderEpoch != "0" || got.BatchNonce != "" {
				t.Fatal(got)
			}
		} else if got.Classification != "internal_reward_conversion" || got.BatchNonce != "1" || got.HolderEpoch != "" {
			t.Fatal(got)
		}
	}
}
func TestAllocationEventsCannotDoubleCountConversions(t *testing.T) {
	for _, sig := range []string{"RewardConverted(bytes32,address,uint32,uint256,uint256)", "FeeClaimed(bytes32,address,uint8,address,uint32,uint256)", "CurveSell(address,address,uint256,uint256,uint256,uint256)"} {
		e := conversionEvent(false)
		e.Signature = sig
		if _, err := NormalizeConversionSummary(e); !errors.Is(err, ErrNotConversionSummary) {
			t.Fatal(sig, err)
		}
	}
}
func TestConversionSummaryRejectsMalformedAmountsAndIdentity(t *testing.T) {
	for _, mutate := range []func(*events.Decoded){
		func(e *events.Decoded) { e.Module = "TickerGardenCurve" },
		func(e *events.Decoded) { e.Args["quoteAsset"] = e.Args["memeAsset"] },
		func(e *events.Decoded) { e.Args["memeSpent"] = "0" },
		func(e *events.Decoded) { e.Args["quoteReceived"] = "1e3" },
		func(e *events.Decoded) { e.Args["nonce"] = "0" },
		func(e *events.Decoded) { e.Args["marketId"] = "bad" },
	} {
		e := conversionEvent(false)
		mutate(&e)
		if _, err := NormalizeConversionSummary(e); err == nil {
			t.Fatal("invalid event accepted")
		}
	}
	e := conversionEvent(true)
	e.Args["epochId"] = "4294967296"
	if _, err := NormalizeConversionSummary(e); err == nil {
		t.Fatal("epoch overflow")
	}
}
