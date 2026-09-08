package principal

import (
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/events"
)

var testAsset = "0x" + strings.Repeat("1", 64)
var testUser = "0x" + strings.Repeat("2", 40)
var testMarket = "0x" + strings.Repeat("3", 64)

func ev(name, asset, market, amount string) events.Decoded {
	return events.Decoded{Module: "UserStockVault", Signature: name + "(bytes32,address,uint256)", Args: map[string]any{"assetUid": asset, "user": testUser, "marketId": market, "amount": amount, "userMarketAllocation": amount, "userTotalAllocated": amount}}
}

func TestLedgerPrincipalLifecycleAndAssetIsolation(t *testing.T) {
	l := New()
	if err := l.Apply(ev("StockDeposited", testAsset, "", "100")); err != nil {
		t.Fatal(err)
	}
	lock := ev("AllocationLocked", testAsset, testMarket, "40")
	lock.Args["userMarketAllocation"] = "40"
	lock.Args["userTotalAllocated"] = "40"
	if err := l.Apply(lock); err != nil {
		t.Fatal(err)
	}
	release := ev("AllocationReleased", testAsset, testMarket, "40")
	release.Args["userMarketAllocation"] = "0"
	release.Args["userTotalAllocated"] = "0"
	if err := l.Apply(release); err != nil {
		t.Fatal(err)
	}
	if err := l.Apply(ev("StockWithdrawn", testAsset, "", "40")); err != nil {
		t.Fatal(err)
	}
	if err := l.Apply(ev("AllocationRageQuit", testAsset, testMarket, "40")); err != nil {
		t.Fatal(err)
	}
	if err := l.Apply(ev("StockDeposited", testMarket, "", "7")); err != nil {
		t.Fatal(err)
	}
	if got := l.Accounts(); len(got) != 2 || got[0].Deposited != "7" && got[1].Deposited != "7" {
		t.Fatalf("accounts: %+v", got)
	}
	if !reflect.DeepEqual(l.Accounts(), []Account{{AssetUID: testAsset, User: testUser, Deposited: "60", Allocated: "0", Free: "60"}, {AssetUID: testMarket, User: testUser, Deposited: "7", Allocated: "0", Free: "7"}}) {
		t.Fatal("wrong final balances", l.Accounts())
	}
	if len(l.Allocations()) != 1 || l.Allocations()[0].Amount != "0" {
		t.Fatalf("allocations: %+v", l.Allocations())
	}
}

func TestLedgerRejectsCheckpointAndOverwithdrawWithoutMutation(t *testing.T) {
	l := New()
	if err := l.Apply(ev("StockDeposited", testAsset, "", "10")); err != nil {
		t.Fatal(err)
	}
	bad := ev("AllocationLocked", testAsset, testMarket, "4")
	bad.Args["userMarketAllocation"] = "0"
	if err := l.Apply(bad); err == nil {
		t.Fatal("accepted malformed checkpoint")
	}
	if err := l.Apply(ev("StockWithdrawn", testAsset, "", "11")); err == nil {
		t.Fatal("accepted overwithdraw")
	}
	if l.Accounts()[0].Deposited != "10" {
		t.Fatal("failed event mutated prior state")
	}
}

func TestLedgerRejectsUint256Overflow(t *testing.T) {
	l := New()
	if err := l.Apply(ev("StockDeposited", testAsset, "", "")); err == nil {
		t.Fatal("expected invalid amount")
	}
	if err := l.Apply(ev("StockDeposited", testAsset, "", "1"+strings.Repeat("0", 78))); err == nil {
		t.Fatal("accepted overflow")
	}
}

func TestAdditionOverflowAndLockedWithdrawalAreAtomic(t *testing.T) {
	l := New()
	max := "115792089237316195423570985008687907853269984665640564039457584007913129639935"
	if e := l.Apply(ev("StockDeposited", testAsset, "", max)); e != nil {
		t.Fatal(e)
	}
	if e := l.Apply(ev("StockDeposited", testAsset, "", "1")); e == nil {
		t.Fatal("sum overflow accepted")
	}
	if l.Accounts()[0].Deposited != max {
		t.Fatal("overflow changed balance")
	}
	l = New()
	if e := l.Apply(ev("StockDeposited", testAsset, "", "10")); e != nil {
		t.Fatal(e)
	}
	if e := l.Apply(ev("AllocationLocked", testAsset, testMarket, "8")); e != nil {
		t.Fatal(e)
	}
	before := l.Accounts()
	allocations := l.Allocations()
	if e := l.Apply(ev("StockWithdrawn", testAsset, "", "3")); e == nil {
		t.Fatal("withdrew allocated funds")
	}
	if !reflect.DeepEqual(before, l.Accounts()) || !reflect.DeepEqual(allocations, l.Allocations()) {
		t.Fatal("rejection mutated ledger")
	}
}
