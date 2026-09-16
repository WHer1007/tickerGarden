package holderledger

import (
	"math/big"
	"strings"
	"testing"
)

const (
	a      = "0x0000000000000000000000000000000000000001"
	b      = "0x0000000000000000000000000000000000000002"
	token  = "0x0000000000000000000000000000000000000010"
	market = "0x1111111111111111111111111111111111111111111111111111111111111111"
)

func ledger(t *testing.T, supply string, balances map[string]string, excluded []string) *Ledger {
	t.Helper()
	l, err := New(Registration{MarketID: market, Token: token, TotalSupply: supply, Timestamp: 0, Balances: balances, Excluded: excluded})
	if err != nil {
		t.Fatal(err)
	}
	return l
}
func action(t *testing.T, l *Ledger, x Action) {
	t.Helper()
	if err := l.Apply(x); err != nil {
		t.Fatal(err)
	}
}
func claimAt(t *testing.T, l *Ledger, who string, ts uint64, amount string) {
	t.Helper()
	action(t, l, Action{Kind: "claim", Timestamp: ts, Account: who, Amount: amount})
}

func TestLedgerFundingSplitsAtHalfTime(t *testing.T) {
	l := ledger(t, "100", map[string]string{a: "100", b: "0", zero: "0", token: "0"}, []string{zero, token})
	action(t, l, Action{Kind: "fund", Timestamp: 0, Amount: "100"})
	action(t, l, Action{Kind: "transfer", Timestamp: 43200, From: a, To: b, Amount: "50"})
	claimAt(t, l, a, Duration, "74")
	claimAt(t, l, b, Duration, "25")
	if l.Paid.String() != "99" || l.Funded.String() != "100" {
		t.Fatalf("paid/funded=%s/%s", l.Paid, l.Funded)
	}
}

func TestLedgerSameTimestampFundingMergesAndRounds(t *testing.T) {
	l := ledger(t, "3", map[string]string{a: "3", zero: "0", token: "0"}, []string{zero, token})
	action(t, l, Action{Kind: "fund", Timestamp: 0, Amount: "1"})
	action(t, l, Action{Kind: "fund", Timestamp: 0, Amount: "2"})
	if len(l.Streams) != 1 {
		t.Fatalf("streams=%d", len(l.Streams))
	}
	claimAt(t, l, a, Duration, "3")
	if l.Paid.String() != "3" || l.IndexRemainder.Sign() != 0 {
		t.Fatalf("paid/remainder=%s/%s", l.Paid, l.IndexRemainder)
	}
}

func TestLedgerZeroSupplyIdleThenRestart(t *testing.T) {
	l := ledger(t, "1", map[string]string{a: "1", zero: "0", token: "0"}, []string{zero, token, a})
	action(t, l, Action{Kind: "fund", Timestamp: 0, Amount: "100"})
	action(t, l, Action{Kind: "checkpoint", Timestamp: 43200})
	if l.Idle.Sign() == 0 {
		t.Fatal("expected idle rewards")
	}
	action(t, l, Action{Kind: "transfer", Timestamp: 43200, From: a, To: b, Amount: "1"})
	if l.Idle.Sign() != 0 || len(l.Streams) != 2 {
		t.Fatalf("idle/streams=%s/%d", l.Idle, len(l.Streams))
	}
}

func TestLedgerExcludedBalancesDoNotEarn(t *testing.T) {
	l := ledger(t, "100", map[string]string{a: "50", b: "40", token: "10", zero: "0"}, []string{zero, token})
	action(t, l, Action{Kind: "fund", Timestamp: 0, Amount: "90"})
	claimAt(t, l, a, Duration, "50")
	claimAt(t, l, b, Duration, "40")
	if l.Paid.String() != "90" {
		t.Fatalf("paid=%s", l.Paid)
	}
}

func TestLedgerSelfTransferSilentCheckpointAndRounding(t *testing.T) {
	l := ledger(t, "3", map[string]string{a: "3", zero: "0", token: "0"}, []string{zero, token})
	action(t, l, Action{Kind: "fund", Timestamp: 0, Amount: "1"})
	action(t, l, Action{Kind: "transfer", Timestamp: 1, From: a, To: a, Amount: "0"})
	if l.UpdatedAt != 1 {
		t.Fatalf("updated=%d", l.UpdatedAt)
	}
	if _, err := l.View(2); err != nil {
		t.Fatal(err)
	}
}

func TestLedgerWrongClaimRollsBack(t *testing.T) {
	l := ledger(t, "1", map[string]string{a: "1", zero: "0", token: "0"}, []string{zero, token})
	action(t, l, Action{Kind: "fund", Timestamp: 0, Amount: "1"})
	before := l.Bytes
	if err := l.Apply(Action{Kind: "claim", Timestamp: Duration, Account: a, Amount: "2"}); err == nil {
		t.Fatal("accepted wrong claim")
	}
	if l.Paid.Sign() != 0 || l.UpdatedAt != 0 || len(l.Streams) != 1 {
		t.Fatal("failed claim mutated state")
	}
	_ = before
}

func TestLedgerCapacity64(t *testing.T) {
	l := ledger(t, "1", map[string]string{a: "1", zero: "0", token: "0"}, []string{zero, token})
	for i := 0; i < MaxStreams; i++ {
		action(t, l, Action{Kind: "fund", Timestamp: uint64(i), Amount: "1"})
	}
	if len(l.Streams) != MaxStreams {
		t.Fatalf("streams=%d", len(l.Streams))
	}
	if err := l.Apply(Action{Kind: "fund", Timestamp: MaxStreams, Amount: "1"}); err == nil {
		t.Fatal("accepted 65th stream")
	}
}

func TestLedgerRejectsBackwardTime(t *testing.T) {
	l := ledger(t, "1", map[string]string{a: "1", zero: "0", token: "0"}, []string{zero, token})
	action(t, l, Action{Kind: "checkpoint", Timestamp: 10})
	if err := l.Apply(Action{Kind: "checkpoint", Timestamp: 9}); err == nil {
		t.Fatal("accepted backward time")
	}
}

func TestLedgerIndependentIntegerExpectation(t *testing.T) {
	l := ledger(t, "7", map[string]string{a: "7", zero: "0", token: "0"}, []string{zero, token})
	action(t, l, Action{Kind: "fund", Timestamp: 0, Amount: "7"})
	action(t, l, Action{Kind: "checkpoint", Timestamp: Duration / 2})
	want := new(big.Int).Mul(big.NewInt(7), precision)
	want.Quo(want, big.NewInt(int64(Duration)))
	want.Mul(want, big.NewInt(int64(Duration/2)))
	want.Quo(want, big.NewInt(7))
	if l.Index.Cmp(want) != 0 {
		t.Fatalf("index=%s want=%s", l.Index, want)
	}
	if strings.TrimSpace(l.Accounts[a].Earned.String()) != "0" {
		t.Fatal("unexpected eager account accrual")
	}
}
