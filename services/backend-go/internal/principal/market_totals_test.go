package principal

import (
	"reflect"
	"strings"
	"testing"
)

func TestMarketTotalsSumsMultipleUsersInOneMarket(t *testing.T) {
	user2 := "0x" + strings.Repeat("4", 40)
	l := New()

	applyTotalsEvent(t, l, "StockDeposited", testAsset, testUser, "", "100")
	applyTotalsEvent(t, l, "AllocationLocked", testAsset, testUser, testMarket, "30")
	applyTotalsEvent(t, l, "StockDeposited", testAsset, user2, "", "50")
	second := ev("AllocationLocked", testAsset, testMarket, "20")
	second.Args["user"] = user2
	second.Args["userMarketAllocation"] = "20"
	second.Args["userTotalAllocated"] = "20"
	if err := l.Apply(second); err != nil {
		t.Fatal(err)
	}

	want := []MarketTotal{{AssetUID: testAsset, MarketID: testMarket, Allocated: "50", Accounts: 2}}
	if got := l.MarketTotals(); !reflect.DeepEqual(got, want) {
		t.Fatalf("totals: got %#v, want %#v", got, want)
	}
}

func TestMarketTotalsSeparatesAssetsAndMarketsAndSortsDeterministically(t *testing.T) {
	assetA := "0x" + strings.Repeat("a", 64)
	assetB := "0x" + strings.Repeat("b", 64)
	marketA := "0x" + strings.Repeat("1", 64)
	marketB := "0x" + strings.Repeat("2", 64)
	l := New()

	applyTotalsEvent(t, l, "StockDeposited", assetA, testUser, "", "8")
	applyTotalsEvent(t, l, "StockDeposited", assetB, testUser, "", "16")
	applyTotalsEvent(t, l, "AllocationLocked", assetB, testUser, marketB, "9")
	second := ev("AllocationLocked", assetB, marketA, "7")
	second.Args["userTotalAllocated"] = "16"
	if err := l.Apply(second); err != nil {
		t.Fatal(err)
	}
	applyTotalsEvent(t, l, "AllocationLocked", assetA, testUser, marketB, "8")

	want := []MarketTotal{
		{AssetUID: assetA, MarketID: marketB, Allocated: "8", Accounts: 1},
		{AssetUID: assetB, MarketID: marketA, Allocated: "7", Accounts: 1},
		{AssetUID: assetB, MarketID: marketB, Allocated: "9", Accounts: 1},
	}
	if got := l.MarketTotals(); !reflect.DeepEqual(got, want) {
		t.Fatalf("totals: got %#v, want %#v", got, want)
	}
}

func TestMarketTotalsRetainsReleasedMarketAtZero(t *testing.T) {
	l := New()
	applyTotalsEvent(t, l, "StockDeposited", testAsset, testUser, "", "40")
	applyTotalsEvent(t, l, "AllocationLocked", testAsset, testUser, testMarket, "40")
	release := ev("AllocationReleased", testAsset, testMarket, "40")
	release.Args["userMarketAllocation"] = "0"
	release.Args["userTotalAllocated"] = "0"
	if err := l.Apply(release); err != nil {
		t.Fatal(err)
	}

	want := []MarketTotal{{AssetUID: testAsset, MarketID: testMarket, Allocated: "0", Accounts: 1}}
	if got := l.MarketTotals(); !reflect.DeepEqual(got, want) {
		t.Fatalf("totals: got %#v, want %#v", got, want)
	}
}

func TestMarketTotalsDoesNotCountDepositedPrincipal(t *testing.T) {
	l := New()
	applyTotalsEvent(t, l, "StockDeposited", testAsset, testUser, "", "100")
	applyTotalsEvent(t, l, "AllocationLocked", testAsset, testUser, testMarket, "40")

	want := []MarketTotal{{AssetUID: testAsset, MarketID: testMarket, Allocated: "40", Accounts: 1}}
	if got := l.MarketTotals(); !reflect.DeepEqual(got, want) {
		t.Fatalf("totals: got %#v, want %#v", got, want)
	}
}
