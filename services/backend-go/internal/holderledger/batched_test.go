package holderledger

import (
	"context"
	"math/big"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestBatchedFragmentedFundingAndCheckpointPersistence(t *testing.T) {
	l, err := New(Registration{Batched: true, MarketID: market, Token: token, Timestamp: 0, TotalSupply: "100", Balances: map[string]string{a: "100", zero: "0", token: "0"}, Excluded: []string{zero, token}})
	if err != nil {
		t.Fatal(err)
	}
	for ts := uint64(0); ts < 100; ts++ {
		if err = l.Apply(Action{Kind: "fund", Timestamp: ts, Amount: "24"}); err != nil {
			t.Fatal(err)
		}
	}
	if len(l.Streams) != 1 || l.LastStreamStartedAt != 0 || l.Idle.Cmp(new(big.Int).Mul(big.NewInt(99*24), precision)) != 0 {
		t.Fatal("fragmentation changed stream clock or lost pending funds")
	}
	raw, err := EncodeCheckpoint(l)
	if err != nil {
		t.Fatal(err)
	}
	l, err = DecodeCheckpoint(raw)
	if err != nil || !l.Batched {
		t.Fatal("batch mode lost on restore", err)
	}
	if err = l.Apply(Action{Kind: "checkpoint", Timestamp: FundingInterval}); err != nil {
		t.Fatal(err)
	}
	if len(l.Streams) != 2 || l.Idle.Sign() != 0 || l.LastStreamStartedAt != FundingInterval {
		t.Fatal("queued batch not started")
	}
	s, err := l.View(Duration)
	if err != nil {
		t.Fatal(err)
	}
	if s.Accounts[a].Claimable != "2004" {
		t.Fatal(s.Accounts[a])
	} // 24 + 99*24*(20/24)
	if err = l.Apply(Action{Kind: "claim", Timestamp: Duration + FundingInterval, Account: a, Amount: "2400"}); err != nil {
		t.Fatal(err)
	}
	if l.Funded.Cmp(l.Paid) != 0 {
		t.Fatal("funds not conserved")
	}
}

func TestBatchedReconciliationRequiresMatchingVersionAndAdmissionClock(t *testing.T) {
	for _, kind := range []string{"valid", "mode", "clock", "interval"} {
		t.Run(kind, func(t *testing.T) {
			l, f, c := stateCase(t)
			l.Batched = true
			l.LastStreamStartedAt = 1
			set := func(sig, args string, values ...string) {
				f.responses[c.Binding.Distributor+selector(sig)+args] = abiWords(values...)
			}
			set("rewardMode()", "", deployment.Hash([]byte(deployment.BatchedContinuousHolderMode)))
			set("lastStreamStartedAt(bytes32)", market[2:], "1")
			set("FUNDING_INTERVAL()", "", "14400")
			switch kind {
			case "mode":
				l.Batched = false
			case "clock":
				set("lastStreamStartedAt(bytes32)", market[2:], "2")
			case "interval":
				set("FUNDING_INTERVAL()", "", "1")
			}
			_, err := l.Reconcile(context.Background(), f, c, f.block)
			if (err == nil) != (kind == "valid") {
				t.Fatal(kind, err)
			}
		})
	}
}

func TestConfigurableBatchUsesPerMarketIntervalAndFixedCapacity(t *testing.T) {
	l, err := New(Registration{Batched: true, ConfigurableInterval: true, MarketID: market, Token: token, TotalSupply: "100", Balances: map[string]string{a: "100", zero: "0", token: "0"}, Excluded: []string{zero, token}})
	if err != nil {
		t.Fatal(err)
	}
	if l.maxStreams() != 24 || l.interval() != FundingInterval {
		t.Fatalf("mode defaults: streams=%d interval=%d", l.maxStreams(), l.interval())
	}
	if err := l.Apply(Action{Kind: "fund", Timestamp: 1, Amount: "1"}); err != nil {
		t.Fatal(err)
	}
	beforeUpdate := l.UpdatedAt
	if err := l.Apply(Action{Kind: "setFundingInterval", Timestamp: 1800, Interval: 3600}); err != nil {
		t.Fatal(err)
	}
	if l.UpdatedAt != beforeUpdate {
		t.Fatalf("configuration update checkpointed accounting state: %d", l.UpdatedAt)
	}
	if err := l.Apply(Action{Kind: "fund", Timestamp: 3601, Amount: "1"}); err != nil {
		t.Fatal(err)
	}
	if l.LastStreamStartedAt != 3601 || len(l.Streams) != 2 {
		t.Fatalf("interval did not affect next admission: last=%d streams=%d", l.LastStreamStartedAt, len(l.Streams))
	}
	for _, interval := range []uint64{3599, 86401} {
		if err := l.Apply(Action{Kind: "setFundingInterval", Timestamp: 3602, Interval: interval}); err == nil {
			t.Fatalf("accepted invalid interval %d", interval)
		}
	}
}

func TestConfigurableReconciliationReadsMarketInterval(t *testing.T) {
	for _, interval := range []string{"3600", "14400"} {
		l, f, c := stateCase(t)
		l.Batched = true
		l.ConfigurableInterval = true
		l.FundingInterval = 3600
		l.LastStreamStartedAt = 1
		set := func(sig, args string, values ...string) {
			f.responses[c.Binding.Distributor+selector(sig)+args] = abiWords(values...)
		}
		set("rewardMode()", "", deployment.Hash([]byte(deployment.ConfigurableBatchedContinuousHolderMode)))
		set("lastStreamStartedAt(bytes32)", market[2:], "1")
		set("fundingInterval(bytes32)", market[2:], interval)
		_, err := l.Reconcile(context.Background(), f, c, f.block)
		if (err == nil) != (interval == "3600") {
			t.Fatalf("interval=%s err=%v", interval, err)
		}
	}
}
