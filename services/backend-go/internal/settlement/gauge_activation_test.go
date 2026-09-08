package settlement

import (
	"encoding/json"
	"math/big"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

func activationPutWords(t *testing.T, state chainrpc.TransactionStateTrace, gauge, base string, before, after []string) {
	t.Helper()
	for i, v := range before {
		slot, e := gaugeSlot(base, uint64(i))
		if e != nil {
			t.Fatal(e)
		}
		a, e := amount(v)
		if e != nil {
			t.Fatal(e)
		}
		b, e := amount(after[i])
		if e != nil {
			t.Fatal(e)
		}
		state.Prestate[gauge].Storage[slot] = "0x" + eventWord(a.Text(16))
		delete(state.Diff.Pre[gauge].Storage, slot)
		delete(state.Diff.Post[gauge].Storage, slot)
		if a.Cmp(b) != 0 {
			if a.Sign() != 0 {
				state.Diff.Pre[gauge].Storage[slot] = "0x" + eventWord(a.Text(16))
			}
			if b.Sign() != 0 {
				state.Diff.Post[gauge].Storage[slot] = "0x" + eventWord(b.Text(16))
			}
		}
	}
}
func gaugeActivationFixture(t *testing.T) (ConversionPreview, chainrpc.TransactionStateTrace, GaugeStorageAccounting, gaugeStorageLayout) {
	t.Helper()
	c := gaugePositionVectors(t)[3]
	p, m, calls, state := gaugeStorageFixture(t, c)
	participants, e := matchGaugeStorage(p, m, calls, state, c.Timestamp)
	if e != nil {
		t.Fatal(e)
	}
	var layout gaugeStorageLayout
	_ = json.Unmarshal(gaugeStorageJSON, &layout)
	gauge := p.Candidate.State.Gauge
	for i := uint64(0); i < 32; i++ {
		base, _ := gaugeSlot(layout.Wheel, i*3)
		if _, ok := state.Prestate[gauge].Storage[base]; !ok {
			activationPutWords(t, state, gauge, base, []string{"0"}, []string{"0"})
		}
	}
	// A second mature bucket belongs entirely to users outside this batch.
	base, _ := gaugeSlot(layout.Wheel, (91%32)*3)
	activationPutWords(t, state, gauge, base, []string{"91", "7", "3"}, []string{"0", "0", "0"})
	snap, _ := gaugeMappingSlot(layout.Snapshots, big.NewInt(91))
	activationPutWords(t, state, gauge, snap, []string{"0", "0", "0", "0"}, []string{c.Current[0], c.Current[1], "3", "1"})
	// Future bucket amount/refs need not be accessed by the checkpoint loop.
	base, _ = gaugeSlot(layout.Wheel, (130%32)*3)
	activationPutWords(t, state, gauge, base, []string{"130"}, []string{"130"})
	activationPutWords(t, state, gauge, layout.ActiveTotal, []string{"3"}, []string{"19"})
	activationPutWords(t, state, gauge, layout.PendingTotal, []string{"21"}, []string{"5"})
	return p, state, participants, layout
}
func TestGaugeActivationAllBuckets(t *testing.T) {
	p, state, participants, _ := gaugeActivationFixture(t)
	got, e := matchGaugeActivation(p, state, participants, 100)
	if e != nil || !got.WheelMatched || !got.TotalsMatched || got.ActivatedStock != "16" || len(got.Snapshots) != 2 || got.ActiveAfter != "19" || got.PendingAfter != "5" {
		t.Fatal(got, e)
	}
	if got.Snapshots[0].RemainingRefs != "1" || got.Snapshots[1].RemainingRefs != "3" {
		t.Fatal(got)
	}
	for _, mode := range []string{"missing-generation", "future-change", "empty-change", "mature-residue", "snapshot", "preexisting-snapshot", "active-total", "pending-total", "missing-total", "refs-underflow", "unverified-participants"} {
		t.Run(mode, func(t *testing.T) {
			p, state, participants, l := gaugeActivationFixture(t)
			g := p.Candidate.State.Gauge
			set := func(base string, offset uint64, value string) {
				slot, _ := gaugeSlot(base, offset)
				state.Diff.Post[g].Storage[slot] = "0x" + eventWord(value)
			}
			switch mode {
			case "missing-generation":
				slot, _ := gaugeSlot(l.Wheel, 0)
				delete(state.Prestate[g].Storage, slot)
			case "future-change":
				slot, _ := gaugeSlot(l.Wheel, (130%32)*3)
				set(slot, 1, "1")
			case "empty-change":
				set(l.Wheel, 1, "1")
			case "mature-residue":
				slot, _ := gaugeSlot(l.Wheel, (91%32)*3)
				set(slot, 2, "1")
			case "snapshot":
				slot, _ := gaugeMappingSlot(l.Snapshots, big.NewInt(91))
				set(slot, 2, "2")
			case "preexisting-snapshot":
				slot, _ := gaugeMappingSlot(l.Snapshots, big.NewInt(91))
				state.Prestate[g].Storage[slot] = "0x" + eventWord("1")
			case "active-total":
				set(l.ActiveTotal, 0, "12")
			case "pending-total":
				set(l.PendingTotal, 0, "4")
			case "missing-total":
				slot, _ := gaugeSlot(l.PendingTotal, 0)
				delete(state.Prestate[g].Storage, slot)
			case "refs-underflow":
				participants.Items = append(participants.Items, participants.Items[0], participants.Items[0])
			case "unverified-participants":
				participants.PositionsMatched = false
			}
			if _, e := matchGaugeActivation(p, state, participants, 100); e == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}
func TestGaugeActivationNoMaturity(t *testing.T) {
	c := gaugePositionVectors(t)[0]
	p, m, calls, state := gaugeStorageFixture(t, c)
	participants, e := matchGaugeStorage(p, m, calls, state, c.Timestamp)
	if e != nil {
		t.Fatal(e)
	}
	var l gaugeStorageLayout
	_ = json.Unmarshal(gaugeStorageJSON, &l)
	for i := uint64(0); i < 32; i++ {
		base, _ := gaugeSlot(l.Wheel, i*3)
		activationPutWords(t, state, p.Candidate.State.Gauge, base, []string{"0"}, []string{"0"})
	}
	got, e := matchGaugeActivation(p, state, participants, c.Timestamp)
	if e != nil || got.ActivatedStock != "0" || got.ActiveBefore != "" || got.PendingBefore != "" {
		t.Fatal(got, e)
	}
	// No-maturity is not permission to ignore a reported aggregate mutation.
	slot, _ := gaugeSlot(l.ActiveTotal, 0)
	state.Diff.Post[p.Candidate.State.Gauge].Storage[slot] = "0x" + eventWord("1")
	if _, e := matchGaugeActivation(p, state, participants, c.Timestamp); e == nil {
		t.Fatal("unexplained active total mutation")
	}
}

func TestGaugeActivationSnapshotCreatedThenDeleted(t *testing.T) {
	p, state, participants, l := gaugeActivationFixture(t)
	second := participants.Items[0]
	second.User = "0x1111111111111111111111111111111111111111"
	participants.Items = append(participants.Items, second)
	// Both references are consumed in the transaction. A complete state diff
	// omits the snapshot's temporary creation because its final value is zero.
	base, e := gaugeMappingSlot(l.Snapshots, big.NewInt(90))
	if e != nil {
		t.Fatal(e)
	}
	activationPutWords(t, state, p.Candidate.State.Gauge, base, []string{"0", "0", "0", "0"}, []string{"0", "0", "0", "0"})
	got, e := matchGaugeActivation(p, state, participants, 100)
	if e != nil || got.Snapshots[0].RemainingRefs != "0" || got.Snapshots[0].Snapshot.Processed {
		t.Fatal(got, e)
	}
}
