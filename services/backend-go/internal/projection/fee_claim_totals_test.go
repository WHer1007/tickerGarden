package projection

import (
	"fmt"
	"math/big"
	"strings"
	"testing"

	"tickergarden/backend/internal/events"
)

func feeClaimFixture(t *testing.T) Input {
	t.Helper()
	for _, input := range fixtureInputs(t) {
		decoded, err := events.Decode(input.Module, input.Log)
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(decoded.Signature, "FeeClaimed(") {
			return input
		}
	}
	t.Fatal("golden fixture has no FeeClaimed input")
	return Input{}
}

func feeClaimWord(v string) string {
	v = strings.TrimPrefix(v, "0x")
	return strings.Repeat("0", 64-len(v)) + v
}

func feeClaimHex(v string) string { return "0x" + feeClaimWord(v) }
func feeClaimAddress(v string) string {
	v = strings.TrimPrefix(v, "0x")
	return "0x" + strings.Repeat("0", 40-len(v)) + v
}

func feeClaimInput(base Input, logIndex int, beneficiaryType, beneficiary, market, epoch, asset, amount string) Input {
	in := base
	in.Log.Topics = append([]string(nil), base.Log.Topics...)
	in.Log.Topics[1] = "0x" + feeClaimWord(beneficiaryType)
	in.Log.Topics[2] = "0x" + feeClaimWord(beneficiary)
	in.Log.Topics[3] = "0x" + feeClaimWord(market)
	words := make([]string, 0, 3)
	for _, word := range []string{epoch, asset, amount} {
		words = append(words, feeClaimWord(word))
	}
	in.Log.Data = "0x" + strings.Join(words, "")
	in.Log.LogIndex = fmt.Sprintf("0x%x", logIndex)
	return in
}

func feeClaimTotal(t *testing.T, s *State, market, asset, role, beneficiary, epoch string) Row {
	t.Helper()
	row := s.tables["feeClaimTotals"][key(feeClaimHex(market), feeClaimAddress(asset), role, feeClaimAddress(beneficiary), epoch)]
	if row == nil {
		t.Fatalf("missing fee claim total row")
	}
	return values(row)
}

func TestFeeClaimTotals(t *testing.T) {
	base := feeClaimFixture(t)
	market, asset, beneficiary := "0x2", "0x6", "0x8"
	s := New()
	claims := []Input{
		feeClaimInput(base, 100, "1", beneficiary, market, "1", asset, "7"),
		feeClaimInput(base, 101, "1", beneficiary, market, "1", asset, "b"),
	}
	var firstClaim any
	for i, input := range claims {
		if status, err := s.Apply(input); err != nil || status != "applied" {
			t.Fatalf("apply claim: %s %v", status, err)
		}
		if i == 0 {
			firstClaim = feeClaimTotal(t, s, market, asset, "1", beneficiary, "1")["firstClaimEventKey"]
		}
	}
	v := feeClaimTotal(t, s, market, asset, "1", beneficiary, "1")
	if v["claimedAmount"] != "18" || v["claimCount"] != "2" || v["historyComplete"] != false {
		t.Fatalf("repeated claims = %#v", v)
	}
	if firstClaim == nil || v["firstClaimEventKey"] != firstClaim {
		t.Fatal("first claim provenance changed")
	}
	if status, err := s.Apply(claims[1]); err != nil || status != "duplicate" {
		t.Fatalf("duplicate claim = %s %v", status, err)
	}
	if feeClaimTotal(t, s, market, asset, "1", beneficiary, "1")["claimCount"] != "2" {
		t.Fatal("duplicate incremented claim count")
	}

	isolated := []Input{
		feeClaimInput(base, 102, "2", beneficiary, market, "1", asset, "3"),
		feeClaimInput(base, 103, "1", "0x9", market, "1", asset, "4"),
		feeClaimInput(base, 104, "1", beneficiary, market, "2", asset, "5"),
		feeClaimInput(base, 105, "1", beneficiary, market, "1", "0x7", "6"),
		feeClaimInput(base, 106, "1", beneficiary, "0x3", "1", asset, "8"),
	}
	for _, input := range isolated {
		if _, err := s.Apply(input); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct{ asset, role, who, epoch, amount string }{
		{asset, "2", beneficiary, "1", "3"}, {asset, "1", "0x9", "1", "4"},
		{asset, "1", beneficiary, "2", "5"}, {"0x7", "1", beneficiary, "1", "6"},
	} {
		if got := feeClaimTotal(t, s, market, tc.asset, tc.role, tc.who, tc.epoch)["claimedAmount"]; got != tc.amount {
			t.Fatalf("isolated total = %v, want %s", got, tc.amount)
		}
	}
	if got := feeClaimTotal(t, s, "0x3", asset, "1", beneficiary, "1")["claimedAmount"]; got != "8" {
		t.Fatalf("isolated market total = %v", got)
	}
	if got := feeClaimTotal(t, s, market, asset, "1", beneficiary, "1")["claimedAmount"]; got != "18" {
		t.Fatalf("original total changed = %v", got)
	}
}

func TestFeeClaimTotalsExceedUint256(t *testing.T) {
	base := feeClaimFixture(t)
	max := "0x" + strings.Repeat("f", 64)
	s := New()
	for i, amount := range []string{max, "1"} {
		input := feeClaimInput(base, 200+i, "1", "0x8", "0x2", "1", "0x6", amount)
		if _, err := s.Apply(input); err != nil {
			t.Fatal(err)
		}
	}
	want := new(big.Int).Lsh(big.NewInt(1), 256)
	v := feeClaimTotal(t, s, "0x2", "0x6", "1", "0x8", "1")
	if v["claimedAmount"] != want.String() || v["claimCount"] != "2" {
		t.Fatalf("huge cumulative = %#v, want %s/2", v, want)
	}
}
