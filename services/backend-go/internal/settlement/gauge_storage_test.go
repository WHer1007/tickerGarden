package settlement

import (
	"encoding/hex"
	"encoding/json"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
)

func gaugeFixturePositionWords(p gaugePositionState) []string {
	packed := new(big.Int).Lsh(new(big.Int).SetUint64(p.UnlockAt), 64)
	packed.Add(packed, new(big.Int).SetUint64(p.Generation))
	w := []string{p.Active, p.Pending, packed.String()}
	for _, r := range p.Rewards {
		w = append(w, r.Paid, r.Pending, r.Remainder)
	}
	return w
}
func gaugeFixtureSnapshotWords(p gaugeSnapshotState) []string {
	b := "0"
	if p.Processed {
		b = "1"
	}
	return []string{p.Accumulators[0], p.Accumulators[1], p.Refs, b}
}
func gaugeStorageFixture(t *testing.T, c gaugePositionVector) (ConversionPreview, ReceiptEventMatch, TraceAccounting, chainrpc.TransactionStateTrace) {
	t.Helper()
	p, m, _ := accountingFixture(t)
	m.Items = m.Items[:1]
	m.MarketID = p.Candidate.Plan.Batches[0].MarketID
	p.Candidate.State.MarketID = m.MarketID
	p.Candidate.State.FeeVault = p.To
	m.Items[0].MaximumMeme = c.Maximum
	pull, _ := amount(c.Expected.Pulled)
	refund, _ := amount(c.Refund)
	m.Items[0].MemeSpent = new(big.Int).Sub(pull, refund).String()
	m.Items[0].QuoteReceived = c.Quote
	calls := TraceAccounting{GaugeItems: []GaugeAccounting{{User: m.Items[0].User, PulledMeme: c.Expected.Pulled, MemeRefund: c.Refund, MemeSpent: m.Items[0].MemeSpent, QuoteReceived: c.Quote}}}
	var layout gaugeStorageLayout
	if json.Unmarshal(gaugeStorageJSON, &layout) != nil {
		t.Fatal("layout")
	}
	implementation := "0x" + strings.Repeat("8", 40)
	clone := "0x363d3d373d3d3d363d73" + implementation[2:] + "5af43d82803e903d91602b57fd5bf3" + eventWord(m.MarketID) + eventWord("1") + eventWord("2") + eventWord("0x"+strings.Repeat("9", 40)) + eventWord(p.To) + eventWord(p.Candidate.State.QuoteAsset) + eventWord(p.Candidate.State.MemeToken)
	raw, e := hex.DecodeString(clone[2:])
	if e != nil {
		t.Fatal(e)
	}
	p.Candidate.State.GaugeRuntimeCodeHash = crypto.Keccak256Hash(raw).Hex()
	state := chainrpc.TransactionStateTrace{Prestate: chainrpc.TraceState{p.Candidate.State.Gauge: {Code: &clone, Storage: map[string]string{}}, implementation: {Code: &layout.Runtime}}, Diff: chainrpc.StateDiff{Pre: chainrpc.TraceState{p.Candidate.State.Gauge: {Storage: map[string]string{}}}, Post: chainrpc.TraceState{p.Candidate.State.Gauge: {Storage: map[string]string{}}}}}
	put := func(base string, before, after []string) {
		for i, v := range before {
			slot, e := gaugeSlot(base, uint64(i))
			if e != nil {
				t.Fatal(e)
			}
			n, e := amount(v)
			if e != nil {
				t.Fatal(e)
			}
			a, e := amount(after[i])
			if e != nil {
				t.Fatal(e)
			}
			state.Prestate[p.Candidate.State.Gauge].Storage[slot] = "0x" + eventWord(n.Text(16))
			if n.Cmp(a) != 0 {
				if n.Sign() != 0 {
					state.Diff.Pre[p.Candidate.State.Gauge].Storage[slot] = "0x" + eventWord(n.Text(16))
				}
				if a.Sign() != 0 {
					state.Diff.Post[p.Candidate.State.Gauge].Storage[slot] = "0x" + eventWord(a.Text(16))
				}
			}
		}
	}
	user, _ := new(big.Int).SetString(m.Items[0].User[2:], 16)
	base, e := gaugeMappingSlot(layout.Positions, user)
	if e != nil {
		t.Fatal(e)
	}
	put(base, gaugeFixturePositionWords(c.Before), gaugeFixturePositionWords(c.Expected.Position))
	for i, acc := range c.Current {
		base, e := gaugeSlot(layout.Rewards, uint64(i*2))
		if e != nil {
			t.Fatal(e)
		}
		put(base, []string{acc}, []string{acc})
	}
	if c.Before.Pending != "0" {
		base, e := gaugeMappingSlot(layout.Snapshots, new(big.Int).SetUint64(c.Before.Generation))
		if e != nil {
			t.Fatal(e)
		}
		put(base, gaugeFixtureSnapshotWords(c.Snapshot), gaugeFixtureSnapshotWords(c.Expected.Snapshot))
		if c.Bucket.Generation != 0 {
			base, e := gaugeSlot(layout.Wheel, (c.Bucket.Generation%32)*3)
			if e != nil {
				t.Fatal(e)
			}
			put(base, []string{new(big.Int).SetUint64(c.Bucket.Generation).String(), c.Bucket.Amount, c.Bucket.Refs}, []string{"0", "0", "0"})
		}
	}
	return p, m, calls, state
}
func TestGaugeStorageVectors(t *testing.T) {
	for _, c := range gaugePositionVectors(t) {
		t.Run(c.Name, func(t *testing.T) {
			p, m, calls, state := gaugeStorageFixture(t, c)
			out, e := matchGaugeStorage(p, m, calls, state, c.Timestamp)
			if e != nil || !out.PositionsMatched || !out.ParticipantSnapshotsMatched || len(out.Items) != 1 || out.Items[0].PulledMeme != c.Expected.Pulled {
				t.Fatal(out, e)
			}
		})
	}
}
func TestGaugeStorageRejectsMissingOrChangedEvidence(t *testing.T) {
	for _, mode := range []string{"pin", "implementation", "implementation-change", "clone-identity", "missing-slot", "pending", "paid", "remainder", "lock", "snapshot", "activation-bucket", "pull", "duplicate"} {
		t.Run(mode, func(t *testing.T) {
			c := gaugePositionVectors(t)[3]
			p, m, calls, state := gaugeStorageFixture(t, c)
			gauge := p.Candidate.State.Gauge
			var layout gaugeStorageLayout
			_ = json.Unmarshal(gaugeStorageJSON, &layout)
			user, _ := new(big.Int).SetString(m.Items[0].User[2:], 16)
			base, _ := gaugeMappingSlot(layout.Positions, user)
			set := func(offset uint64) {
				slot, _ := gaugeSlot(base, offset)
				state.Diff.Post[gauge].Storage[slot] = "0x" + eventWord("123")
			}
			switch mode {
			case "pin":
				p.Candidate.State.GaugeRuntimeCodeHash = ""
			case "implementation":
				delete(state.Prestate, "0x"+strings.Repeat("8", 40))
			case "implementation-change":
				address := "0x" + strings.Repeat("8", 40)
				code := "0x00"
				state.Diff.Pre[address] = chainrpc.TraceAccount{}
				state.Diff.Post[address] = chainrpc.TraceAccount{Code: &code}
			case "clone-identity":
				p.Candidate.State.MemeToken = p.Candidate.State.QuoteAsset
			case "missing-slot":
				slot, _ := gaugeSlot(base, 7)
				delete(state.Prestate[gauge].Storage, slot)
			case "pending":
				set(7)
			case "paid":
				set(6)
			case "remainder":
				set(8)
			case "lock":
				set(2)
			case "snapshot":
				slot, _ := gaugeMappingSlot(layout.Snapshots, new(big.Int).SetUint64(c.Before.Generation))
				slot, _ = gaugeSlot(slot, 2)
				state.Diff.Post[gauge].Storage[slot] = "0x" + eventWord("2")
			case "activation-bucket":
				slot, _ := gaugeSlot(layout.Wheel, (c.Before.Generation%32)*3+1)
				state.Diff.Post[gauge].Storage[slot] = "0x" + eventWord("1")
			case "pull":
				calls.GaugeItems[0].PulledMeme = "1"
			case "duplicate":
				m.Items = append(m.Items, m.Items[0])
				calls.GaugeItems = append(calls.GaugeItems, calls.GaugeItems[0])
			}
			if _, e := matchGaugeStorage(p, m, calls, state, c.Timestamp); e == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}

func TestGaugeStorageSharedSnapshot(t *testing.T) {
	for _, index := range []int{2, 3} {
		c := gaugePositionVectors(t)[index]
		p, m, calls, state := gaugeStorageFixture(t, c)
		gauge := p.Candidate.State.Gauge
		var layout gaugeStorageLayout
		_ = json.Unmarshal(gaugeStorageJSON, &layout)
		second := m.Items[0]
		second.User = "0x" + strings.Repeat("b", 40)
		m.Items = append(m.Items, second)
		call := calls.GaugeItems[0]
		call.User = second.User
		calls.GaugeItems = append(calls.GaugeItems, call)
		user, _ := new(big.Int).SetString(second.User[2:], 16)
		base, _ := gaugeMappingSlot(layout.Positions, user)
		before, after := gaugeFixturePositionWords(c.Before), gaugeFixturePositionWords(c.Expected.Position)
		for i, s := range before {
			slot, _ := gaugeSlot(base, uint64(i))
			a, _ := amount(s)
			b, _ := amount(after[i])
			state.Prestate[gauge].Storage[slot] = "0x" + eventWord(a.Text(16))
			if a.Cmp(b) != 0 {
				if a.Sign() != 0 {
					state.Diff.Pre[gauge].Storage[slot] = "0x" + eventWord(a.Text(16))
				}
				if b.Sign() != 0 {
					state.Diff.Post[gauge].Storage[slot] = "0x" + eventWord(b.Text(16))
				}
			}
		}
		base, _ = gaugeMappingSlot(layout.Snapshots, new(big.Int).SetUint64(c.Before.Generation))
		for i := 0; i < 4; i++ {
			slot, _ := gaugeSlot(base, uint64(i))
			delete(state.Diff.Post[gauge].Storage, slot)
			old := state.Prestate[gauge].Storage[slot]
			n, _ := new(big.Int).SetString(old[2:], 16)
			if n.Sign() != 0 {
				state.Diff.Pre[gauge].Storage[slot] = old
			} else {
				delete(state.Diff.Pre[gauge].Storage, slot)
			}
		}
		got, e := matchGaugeStorage(p, m, calls, state, c.Timestamp)
		if e != nil || len(got.Items) != 2 {
			t.Fatal(index, got, e)
		}
	}
}
