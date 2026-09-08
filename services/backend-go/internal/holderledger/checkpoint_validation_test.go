package holderledger

import (
	"encoding/json"
	"math/big"
	"testing"
)

func TestCheckpointRejectsBrokenState(t *testing.T) {
	for _, mutate := range []func(*Ledger){
		func(l *Ledger) { l.Supply = nil }, func(l *Ledger) { l.Supply = big.NewInt(-1) }, func(l *Ledger) { l.Supply.Add(l.Supply, big.NewInt(1)) }, func(l *Ledger) { l.Head = 64 }, func(l *Ledger) { l.Rate = big.NewInt(1) }, func(l *Ledger) {
			l.Streams = []Stream{{End: l.UpdatedAt, Rate: big.NewInt(0), Remainder: big.NewInt(0)}}
		}, func(l *Ledger) { l.Excluded[l.Token] = false }, func(l *Ledger) { l.Accounts[a] = nil },
	} {
		l := traceLedger(t)
		mutate(l)
		raw, _ := json.Marshal(l)
		if _, e := DecodeCheckpoint(raw); e == nil {
			t.Fatal("accepted invalid state")
		}
	}
}
func TestCheckpointFundingContinuation(t *testing.T) {
	l := traceLedger(t)
	for _, action := range []Action{{Kind: "fund", Timestamp: 1, Amount: "91"}, {Kind: "fund", Timestamp: 1, Amount: "13"}, {Kind: "checkpoint", Timestamp: 400}, {Kind: "checkpoint", Timestamp: 86401}, {Kind: "checkpoint", Timestamp: 90000}} {
		if e := l.Apply(action); e != nil {
			t.Fatal(e)
		}
		raw, e := EncodeCheckpoint(l)
		if e != nil {
			t.Fatal(e)
		}
		restored, e := DecodeCheckpoint(raw)
		if e != nil {
			t.Fatal(e)
		}
		for key, v := range restored.Accounts {
			v.Balance.Add(v.Balance, big.NewInt(1))
			if v.Balance.Cmp(l.Accounts[key].Balance) == 0 {
				t.Fatal("shared account")
			}
			break
		}
		if _, e = EncodeCheckpoint(l); e != nil {
			t.Fatal(e)
		}
	}
}
