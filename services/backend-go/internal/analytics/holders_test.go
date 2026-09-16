package analytics

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func holderFixture() (string, string, string, []HolderTransfer) {
	addr := func(n int) string { return fmt.Sprintf("0x%040x", n) }
	token, curve, treasury := addr(1), addr(2), addr(3)
	zero := addr(0)
	movements := [][3]string{{zero, curve, "1000"}, {curve, addr(4), "250"}, {curve, treasury, "100"}, {treasury, zero, "40"}, {addr(4), addr(4), "250"}, {addr(4), addr(5), "250"}, {addr(6), addr(5), "0"}}
	ts := []HolderTransfer{}
	for i, m := range movements {
		tx := fmt.Sprintf("0x%064x", i+1)
		ts = append(ts, HolderTransfer{Source: CurveSource{ChainID: 4663, BlockNumber: "1", BlockHash: "0x" + strings.Repeat("a", 64), TransactionHash: tx, TransactionIndex: uint64(i), LogIndex: uint64(i), Emitter: token, EventKey: fmt.Sprintf("4663:%s:%d", tx, i)}, From: m[0], To: m[1], Value: m[2]})
	}
	return token, curve, treasury, ts
}
func TestHolderBalancesReplay(t *testing.T) {
	token, curve, treasury, ts := holderFixture()
	got, err := RebuildHolderBalances(4663, token, curve, treasury, "1000", ts, []string{curve, treasury})
	if err != nil || got.TotalSupplyRaw != "960" || got.PositiveAddressCount != 3 || got.IncludedAddressCount != 1 {
		t.Fatal(got, err)
	}
	if got.Balances[0].BalanceRaw != "650" || got.Balances[1].BalanceRaw != "60" || got.Balances[2].BalanceRaw != "250" {
		t.Fatal(got)
	}
	for i, j := 0, len(ts)-1; i < j; i, j = i+1, j-1 {
		ts[i], ts[j] = ts[j], ts[i]
	}
	again, err := RebuildHolderBalances(4663, token, curve, treasury, "1000", ts, []string{treasury, curve})
	if err != nil || !reflect.DeepEqual(got, again) {
		t.Fatal(again, err)
	}
}
func TestHolderBalancesRejectInvalidHistory(t *testing.T) {
	cases := map[string]func([]HolderTransfer) []HolderTransfer{
		"missing mint":         func(v []HolderTransfer) []HolderTransfer { return v[1:] },
		"duplicate":            func(v []HolderTransfer) []HolderTransfer { return append(v, v[1]) },
		"negative balance":     func(v []HolderTransfer) []HolderTransfer { v[1].Value = "1001"; return v },
		"extra mint":           func(v []HolderTransfer) []HolderTransfer { v[1].From = v[0].From; return v },
		"unauthorized burn":    func(v []HolderTransfer) []HolderTransfer { v[3].From = v[1].To; return v },
		"wrong initial supply": func(v []HolderTransfer) []HolderTransfer { v[0].Value = "999"; return v },
		"wrong emitter":        func(v []HolderTransfer) []HolderTransfer { v[1].Source.Emitter = v[1].To; return v },
		"conflicting block": func(v []HolderTransfer) []HolderTransfer {
			v[1].Source.BlockHash = "0x" + strings.Repeat("b", 64)
			return v
		},
		"noncanonical integer": func(v []HolderTransfer) []HolderTransfer { v[1].Value = "0250"; return v },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			token, curve, treasury, ts := holderFixture()
			if _, err := RebuildHolderBalances(4663, token, curve, treasury, "1000", mutate(ts), nil); err == nil {
				t.Fatal("accepted invalid history")
			}
		})
	}
	token, curve, treasury, ts := holderFixture()
	if _, err := RebuildHolderBalances(4663, token, curve, treasury, "1000", ts, []string{curve, curve}); err == nil {
		t.Fatal("duplicate exclusion")
	}
}

func TestHolderBalancesFullBurnAndLargeSupply(t *testing.T) {
	token, curve, treasury, ts := holderFixture()
	ts = ts[:4]
	ts[1].To = treasury
	ts[1].Value = "1000"
	ts[2].Value = "0"
	ts[3].Value = "1000"
	out, err := RebuildHolderBalances(4663, token, curve, treasury, "1000", ts, nil)
	if err != nil || out.TotalSupplyRaw != "0" || out.PositiveAddressCount != 0 || len(out.Balances) != 0 || out.Balances == nil {
		t.Fatal(out, err)
	}
	token, curve, treasury, ts = holderFixture()
	maximum := "115792089237316195423570985008687907853269984665640564039457584007913129639935"
	ts = ts[:1]
	ts[0].Value = maximum
	out, err = RebuildHolderBalances(4663, token, curve, treasury, maximum, ts, nil)
	if err != nil || out.TotalSupplyRaw != maximum || out.Balances[0].BalanceRaw != maximum {
		t.Fatal(out, err)
	}
}
