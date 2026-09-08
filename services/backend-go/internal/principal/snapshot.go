package principal

import (
	"bytes"
	"encoding/json"
	"errors"
	"math/big"
)

const MaxSnapshotBytes = 64 << 20

// Snapshot is canonical and contains no getter-derived state.
func (l *Ledger) Snapshot() ([]byte, error) {
	raw, e := json.Marshal(struct {
		Accounts    []Account    `json:"accounts"`
		Allocations []Allocation `json:"allocations"`
	}{l.Accounts(), l.Allocations()})
	if e != nil {
		return nil, e
	}
	if len(raw) > MaxSnapshotBytes {
		return nil, errors.New("principal snapshot budget exceeded")
	}
	return raw, nil
}
func Restore(raw []byte) (*Ledger, error) {
	if len(raw) > MaxSnapshotBytes {
		return nil, errors.New("principal snapshot budget exceeded")
	}
	var snapshot struct {
		Accounts    []Account    `json:"accounts"`
		Allocations []Allocation `json:"allocations"`
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if e := d.Decode(&snapshot); e != nil {
		return nil, e
	}
	ledger := New()
	sums := map[string]*big.Int{}
	for _, a := range snapshot.Accounts {
		if !validID(a.AssetUID) || !address.MatchString(a.User) || a.User == "0x0000000000000000000000000000000000000000" {
			return nil, errors.New("invalid checkpoint account")
		}
		key := a.AssetUID + ":" + a.User
		if _, ok := ledger.accounts[key]; ok {
			return nil, errors.New("duplicate checkpoint account")
		}
		dep, e1 := integer(a.Deposited)
		allocated, e2 := integer(a.Allocated)
		free, e3 := integer(a.Free)
		if e1 != nil || e2 != nil || e3 != nil || allocated.Cmp(dep) > 0 || new(big.Int).Sub(dep, allocated).Cmp(free) != 0 {
			return nil, errors.New("checkpoint account conservation mismatch")
		}
		ledger.accounts[key] = a
		sums[key] = new(big.Int)
	}
	for _, a := range snapshot.Allocations {
		key := a.AssetUID + ":" + a.User
		k := key + ":" + a.MarketID
		if sums[key] == nil || !validID(a.MarketID) {
			return nil, errors.New("checkpoint allocation identity mismatch")
		}
		if _, ok := ledger.allocations[k]; ok {
			return nil, errors.New("duplicate checkpoint allocation")
		}
		amount, e := integer(a.Amount)
		if e != nil {
			return nil, e
		}
		sums[key].Add(sums[key], amount)
		ledger.allocations[k] = a
	}
	for key, sum := range sums {
		if sum.Cmp(value(ledger.accounts[key].Allocated)) != 0 {
			return nil, errors.New("checkpoint allocation sum mismatch")
		}
	}
	canonical, e := ledger.Snapshot()
	if e != nil {
		return nil, e
	}
	if !bytes.Equal(raw, canonical) {
		return nil, errors.New("noncanonical principal snapshot")
	}
	return ledger, nil
}
