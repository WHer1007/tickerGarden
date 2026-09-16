package holderledger

import (
	"bytes"
	"testing"
)

func TestCheckpointRoundTripAndContinue(t *testing.T) {
	l := traceLedger(t)
	raw, e := EncodeCheckpoint(l)
	if e != nil {
		t.Fatal(e)
	}
	d, e := DecodeCheckpoint(raw)
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Equal(raw, []byte{}) || d == l {
		t.Fatal("invalid alias")
	}
	if len(d.Accounts) != len(l.Accounts) {
		t.Fatal("accounts")
	}
	a := Action{Kind: "checkpoint", Timestamp: l.UpdatedAt}
	if e = l.Apply(a); e != nil {
		t.Fatal(e)
	}
	if e = d.Apply(a); e != nil {
		t.Fatal(e)
	}
	lb, _ := l.Bytes(l.UpdatedAt)
	db, _ := d.Bytes(d.UpdatedAt)
	if string(lb) != string(db) {
		t.Fatal("continuation diverged")
	}
}
func TestCheckpointRejectsInvalidInputs(t *testing.T) {
	l := traceLedger(t)
	raw, e := EncodeCheckpoint(l)
	if e != nil {
		t.Fatal(e)
	}
	cases := [][]byte{[]byte("{"), append(append([]byte{}, raw...), '\n'), []byte(`{"unknown":1}`), []byte(`null`), make([]byte, 4<<20+1)}
	for i, b := range cases {
		if _, e := DecodeCheckpoint(b); e == nil {
			t.Fatalf("case %d accepted", i)
		}
	}
}
