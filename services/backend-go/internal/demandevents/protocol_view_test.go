package demandevents

import (
	"reflect"
	"testing"
	"time"
)

func protocolViewTestSnapshot(now int64) ProtocolSnapshot {
	wallets := 3
	return ProtocolSnapshot{
		ChainID:           46630,
		DisplayOnly:       true,
		ObservedAt:        now - 60,
		StakingObservedAt: now - 60,
		StakingWallets:    &wallets,
		FeeCoverage:       true,
		FeeAssets: map[string]map[string]string{
			"ETH":  {"creator": "1", "staker": "20", "holder": "300", "platform": "4000"},
			"TSLA": {"creator": "5", "staker": "6", "holder": "7", "platform": "8"},
		},
		FeeTotals: map[string]string{"old": "value"},
	}
}

func TestProtocolViewComputesIndependentPerAssetFourBucketTotals(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	got := protocolView(protocolViewTestSnapshot(now.Unix()), now)

	want := map[string]string{"ETH": "4321", "TSLA": "26"}
	if !reflect.DeepEqual(got.FeeTotals, want) {
		t.Fatalf("FeeTotals = %#v, want %#v", got.FeeTotals, want)
	}
	if !got.FeeCoverage || got.StakingWallets == nil || got.Reason != "" {
		t.Fatalf("view unexpectedly withheld: coverage=%v wallets=%v reason=%q", got.FeeCoverage, got.StakingWallets, got.Reason)
	}
}

func TestProtocolViewExpiresStakingAndFeeIndependently(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	stakingStaleSnapshot := protocolViewTestSnapshot(now.Unix())
	stakingStaleSnapshot.ObservedAt = now.Unix() + int64(19*time.Minute/time.Second)
	stakingStale := protocolView(stakingStaleSnapshot, now.Add(20*time.Minute))
	if stakingStale.StakingWallets != nil {
		t.Fatal("stale staking snapshot still exposed wallet count")
	}
	if !stakingStale.FeeCoverage || len(stakingStale.FeeTotals) != 2 || stakingStale.Reason != "statistics_pending" {
		t.Fatalf("fresh fee coverage was not preserved: coverage=%v totals=%#v reason=%q", stakingStale.FeeCoverage, stakingStale.FeeTotals, stakingStale.Reason)
	}

	feeStaleSnapshot := protocolViewTestSnapshot(now.Unix())
	feeStaleSnapshot.ObservedAt = now.Unix() - int64(20*time.Minute/time.Second)
	feeStaleSnapshot.StakingObservedAt = now.Unix() + int64(19*time.Minute/time.Second)
	feeStale := protocolView(feeStaleSnapshot, now.Add(20*time.Minute))
	if feeStale.FeeCoverage || len(feeStale.FeeTotals) != 0 {
		t.Fatalf("stale fee coverage still exposed: coverage=%v totals=%#v", feeStale.FeeCoverage, feeStale.FeeTotals)
	}
	if feeStale.StakingWallets == nil || feeStale.Reason != "statistics_pending" {
		t.Fatalf("fresh staking count was not preserved: wallets=%v reason=%q", feeStale.StakingWallets, feeStale.Reason)
	}
}

func TestProtocolViewWithholdsInvalidOrMissingFeeBuckets(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	for name, mutate := range map[string]func(map[string]map[string]string){
		"missing bucket":  func(assets map[string]map[string]string) { delete(assets["ETH"], "holder") },
		"invalid number":  func(assets map[string]map[string]string) { assets["ETH"]["holder"] = "not-a-number" },
		"negative number": func(assets map[string]map[string]string) { assets["ETH"]["holder"] = "-1" },
	} {
		t.Run(name, func(t *testing.T) {
			v := protocolViewTestSnapshot(now.Unix())
			mutate(v.FeeAssets)
			got := protocolView(v, now)
			if got.FeeCoverage || len(got.FeeTotals) != 0 || got.Reason != "statistics_pending" {
				t.Fatalf("invalid fee data exposed: coverage=%v totals=%#v reason=%q", got.FeeCoverage, got.FeeTotals, got.Reason)
			}
		})
	}
}

func TestProtocolViewDoesNotMutateCachedSnapshot(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	original := protocolViewTestSnapshot(now.Unix())
	before := original
	before.FeeAssets = map[string]map[string]string{}
	for asset, buckets := range original.FeeAssets {
		before.FeeAssets[asset] = map[string]string{}
		for key, value := range buckets {
			before.FeeAssets[asset][key] = value
		}
	}
	before.FeeTotals = map[string]string{"old": "value"}

	_ = protocolView(original, now)
	if !reflect.DeepEqual(original, before) {
		t.Fatalf("protocolView mutated cached snapshot: got %#v, want %#v", original, before)
	}
}
