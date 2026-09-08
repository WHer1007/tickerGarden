package holderledger

import (
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

const (
	distributor = "0x0000000000000000000000000000000000000020"
	vault       = "0x0000000000000000000000000000000000000030"
)

func traceWord(v string) string    { return strings.Repeat("0", 64-len(v)) + v }
func traceBytes32(v string) string { return "0x" + traceWord(strings.TrimPrefix(v, "0x")) }
func traceAddress(v string) string { return traceWord(strings.TrimPrefix(v, "0x")) }
func traceCall(from, to, input, output string) chainrpc.CallTrace {
	return chainrpc.CallTrace{Type: "CALL", From: from, To: to, Input: input, Output: output}
}
func traceLedger(t *testing.T) *Ledger {
	t.Helper()
	return ledger(t, "100", map[string]string{a: "100", zero: "0", token: "0"}, []string{zero, token})
}
func traceBinding() Binding { return Binding{Distributor: distributor, Vault: vault} }
func traceRoot(calls ...chainrpc.CallTrace) chainrpc.CallTrace {
	return chainrpc.CallTrace{Type: "CALL", From: a, To: distributor, Input: "0x", Calls: calls}
}
func fundInput(amount string) string {
	return selector("fundCreatorFees(bytes32,uint32,uint256)") + traceBytes32(market)[2:] + traceWord("1") + traceWord(amount)
}
func checkpointInput() string {
	return selector("checkpoint(bytes32)") + traceBytes32(market)[2:]
}
func transferInput() string {
	return selector("checkpointTransfer(bytes32,address,address,uint256)") + traceBytes32(market)[2:] + traceAddress(a) + traceAddress(a) + traceWord("0")
}
func claimInput() string {
	return selector("claim(bytes32)") + traceBytes32(market)[2:]
}

func TestApplyTraceAcceptsSilentCheckpointAndZeroClaim(t *testing.T) {
	l := traceLedger(t)
	trace := traceRoot(
		traceCall(vault, distributor, fundInput("40"), ""),
		traceCall(token, distributor, checkpointInput(), ""),
		traceCall(a, distributor, claimInput(), "0x"+traceWord("0")),
	)
	count, err := l.ApplyTrace(0, traceBinding(), trace)
	if err != nil || count != 3 {
		t.Fatalf("ApplyTrace count=%d err=%v", count, err)
	}
	if l.Funded.String() != "64" || l.Paid.Sign() != 0 || l.UpdatedAt != 0 {
		t.Fatalf("unexpected state funded=%s paid=%s updated=%d", l.Funded, l.Paid, l.UpdatedAt)
	}
}

func TestApplyTraceRequiresAuthenticatedTokenAndVault(t *testing.T) {
	cases := []chainrpc.CallTrace{
		traceRoot(traceCall(a, distributor, fundInput("1"), "")),
		traceRoot(traceCall(a, distributor, transferInput(), "")),
	}
	for i, tr := range cases {
		l := traceLedger(t)
		if _, err := l.ApplyTrace(0, traceBinding(), tr); err == nil {
			t.Fatalf("case %d accepted unauthenticated callback", i)
		}
	}
	tr := traceRoot(traceCall(vault, distributor, fundInput("1"), ""))
	if _, err := traceLedger(t).ApplyTrace(0, Binding{Distributor: distributor, Vault: token}, tr); err == nil {
		t.Fatal("accepted fund from wrong vault")
	}
}

func TestApplyTraceIgnoresRevertedChildAndAncestor(t *testing.T) {
	l := traceLedger(t)
	before, _ := l.Bytes(0)
	child := traceCall(vault, distributor, fundInput("9"), "")
	child.Error = "execution reverted"
	ancestor := traceRoot(traceCall(vault, distributor, fundInput("7"), ""))
	ancestor.Error = "execution reverted"
	ancestor.Calls = []chainrpc.CallTrace{child}
	trace := traceRoot(child, ancestor)
	count, err := l.ApplyTrace(0, traceBinding(), trace)
	if err != nil || count != 0 {
		t.Fatalf("reverted trace count=%d err=%v", count, err)
	}
	after, _ := l.Bytes(0)
	if string(before) != string(after) {
		t.Fatal("reverted subtrees changed ledger")
	}
}

func TestApplyTraceMalformedOrMismatchedClaimRollsBackEarlierActions(t *testing.T) {
	for _, claim := range []chainrpc.CallTrace{
		traceCall(a, distributor, claimInput()+traceWord("0"), "0x"+traceWord("0")),
		traceCall(a, distributor, claimInput(), "0x"+traceWord("101")),
	} {
		l := traceLedger(t)
		before, _ := l.Bytes(0)
		tr := traceRoot(traceCall(vault, distributor, fundInput("100"), ""), claim)
		if _, err := l.ApplyTrace(0, traceBinding(), tr); err == nil {
			t.Fatal("accepted malformed or mismatched claim")
		}
		after, _ := l.Bytes(0)
		if string(before) != string(after) {
			t.Fatal("failed trace committed earlier fund")
		}
	}
}
