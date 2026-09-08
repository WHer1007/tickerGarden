package rewards

import (
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
)

func claimInput(index uint64, epoch, amount string) projection.Input {
	in := convLog(index, "", strings.Repeat("1", 64), strings.Repeat("4", 40), epoch, amount, "0", false)
	in.Log.Topics = []string{deployment.Hash([]byte("FeeClaimed(uint8,address,bytes32,uint32,address,uint256)")), "0x" + convWord("0"), "0x" + convWord(strings.Repeat("4", 40)), "0x" + strings.Repeat("1", 64)}
	in.Log.Data = "0x" + convWord(epoch) + convWord(strings.Repeat("2", 40)) + convWord(amount)
	return in
}
func TestClaimsReplayAmountsEpochsAndDuplicates(t *testing.T) {
	a, b, c := claimInput(1, "1", "7"), claimInput(2, "1", "b"), claimInput(3, "2", "1")
	totals, e := ClaimsFromInputs([]projection.Input{a, b, c})
	if e != nil || len(totals) != 2 {
		t.Fatal(totals, e)
	}
	if totals[0].Amount != "18" || totals[0].Count != "2" || totals[0].Epoch != "1" || !strings.HasSuffix(totals[0].First, ":1") || totals[1].Amount != "1" || totals[1].Epoch != "2" {
		t.Fatal(totals)
	}
	if _, e = ClaimsFromInputs([]projection.Input{a, a}); e == nil {
		t.Fatal("duplicate accepted")
	}
	a.Log.Removed = true
	if _, e = ClaimsFromInputs([]projection.Input{a}); e == nil {
		t.Fatal("removed accepted")
	}
}
func TestClaimsReplayUnboundedAndConversionExcluded(t *testing.T) {
	totals, e := ClaimsFromInputs([]projection.Input{claimInput(1, "1", strings.Repeat("f", 64)), claimInput(2, "1", "1")})
	if e != nil || totals[0].Amount != "115792089237316195423570985008687907853269984665640564039457584007913129639936" {
		t.Fatal(totals, e)
	}
	in := convLog(1, "0x536d8aaaf2bd3a634add9a0cbb15879e5cd81e4ef97a16fe231d48974e4c49d2", strings.Repeat("1", 64), strings.Repeat("4", 40), "1", "5", "3", false)
	totals, e = ClaimsFromInputs([]projection.Input{in})
	if e != nil || len(totals) != 0 {
		t.Fatal(totals, e)
	}
}

func TestClaimAccumulatorIncrementalSnapshotsAndMutationIsolation(t *testing.T) {
	a := newClaimAccumulator()
	one, two := claimInput(1, "1", "7"), claimInput(2, "1", "b")
	if err := a.add(one); err != nil {
		t.Fatal(err)
	}
	snapshot := a.result()
	if len(snapshot) != 1 || snapshot[0].Amount != "7" || snapshot[0].Count != "1" || !strings.HasSuffix(snapshot[0].First, ":1") {
		t.Fatal(snapshot)
	}
	snapshot[0].Amount = "999"
	if got := a.result(); len(got) != 1 || got[0].Amount != "7" {
		t.Fatal("result mutation changed accumulator", got)
	}
	if err := a.add(two); err != nil {
		t.Fatal(err)
	}
	got := a.result()
	if len(got) != 1 || got[0].Amount != "18" || got[0].Count != "2" || got[0].First != snapshot[0].First {
		t.Fatal(got)
	}
}

func TestClaimAccumulatorRejectedLateInputsPreserveTotals(t *testing.T) {
	a := newClaimAccumulator()
	one, two := claimInput(1, "1", "7"), claimInput(2, "1", "b")
	if err := a.add(one); err != nil {
		t.Fatal(err)
	}
	before := a.result()
	badABI := two
	badABI.Log.Data = "0x01"
	if err := a.add(badABI); err == nil {
		t.Fatal("malformed ABI accepted")
	}
	if got := a.result(); len(got) != 1 || got[0] != before[0] {
		t.Fatal("malformed ABI changed totals", got)
	}
	malformed := two
	malformed.Log.LogIndex = "not-a-quantity"
	if err := a.add(malformed); err == nil {
		t.Fatal("malformed claim accepted")
	}
	if got := a.result(); len(got) != 1 || got[0] != before[0] {
		t.Fatal("malformed input changed totals", got)
	}
	if err := a.add(two); err != nil {
		t.Fatal("valid event rejected after malformed input:", err)
	}
	if err := a.add(one); err == nil {
		t.Fatal("duplicate claim accepted")
	}
	removed := claimInput(3, "1", "d")
	removed.Log.Removed = true
	if err := a.add(removed); err == nil {
		t.Fatal("removed claim accepted")
	}
	got := a.result()
	if len(got) != 1 || got[0].Amount != "18" || got[0].Count != "2" {
		t.Fatal("rejected input changed totals", got)
	}
}

func TestClaimAccumulatorConversionsRetainNoState(t *testing.T) {
	a := newClaimAccumulator()
	for i := uint64(1); i <= 1000; i++ {
		if err := a.add(convLog(i, "0x536d8aaaf2bd3a634add9a0cbb15879e5cd81e4ef97a16fe231d48974e4c49d2", strings.Repeat("1", 64), strings.Repeat("4", 40), "1", "5", "3", false)); err != nil {
			t.Fatal(err)
		}
	}
	if len(a.seen) != 0 || len(a.totals) != 0 || len(a.result()) != 0 {
		t.Fatal("conversion inputs retained claim state", len(a.seen), len(a.totals))
	}
}
func TestVerifiedClaimInputsRejectRehashedSummary(t *testing.T) {
	base := fixtureObservations()
	rows, e := Build(base, nil)
	if e != nil {
		t.Fatal(e)
	}
	rows[0].Value["observedClaimedAmount"] = "999"
	rows[0].Value["observedClaimCount"] = "1"
	rows[0].Value["firstClaimEventKey"] = "forged"
	if _, e = VerifyPositions(append(base, rows...)); e != nil {
		t.Fatal("test must be internally consistent", e)
	}
	if _, e = VerifyPositionsAgainstClaims(append(base, rows...), nil); e == nil {
		t.Fatal("forged summary accepted")
	}
}
