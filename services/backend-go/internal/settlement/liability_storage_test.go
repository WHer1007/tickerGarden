package settlement

import (
	"encoding/json"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
)

func liabilityFixture(t *testing.T) (ConversionPreview, ReceiptEventMatch, chainrpc.TransactionStateTrace, feeVaultLayout) {
	t.Helper()
	p, m, _, state := creatorStorageFixture(t)
	var layout feeVaultLayout
	if json.Unmarshal(feeVaultStorageJSON, &layout) != nil {
		t.Fatal("layout")
	}
	add := func(asset string, bucket int, before, after string) {
		var b *uint8
		root := layout.TotalSlot
		if bucket >= 0 {
			n := uint8(bucket)
			b = &n
			root = layout.BucketSlot
		}
		slot, e := liabilityStorageSlot(root, m.MarketID, asset, b)
		if e != nil {
			t.Fatal(e)
		}
		state.Prestate[p.To].Storage[slot] = "0x" + eventWord(before)
		if before != after {
			state.Diff.Pre[p.To].Storage[slot] = "0x" + eventWord(before)
			state.Diff.Post[p.To].Storage[slot] = "0x" + eventWord(after)
		}
	}
	// Totals include other markets; their absolute values need not equal this
	// market's bucket sum. Only the transaction's deltas are being reconciled.
	add(p.Candidate.State.MemeToken, -1, "64", "61")
	add(p.Candidate.State.QuoteAsset, -1, "3e8", "514")
	add(p.Candidate.State.MemeToken, 0, "a", "9")
	add(p.Candidate.State.MemeToken, 1, "32", "30")
	add(p.Candidate.State.QuoteAsset, 0, "a", "6e")
	add(p.Candidate.State.QuoteAsset, 1, "14", "dc")
	add(p.Candidate.State.MemeToken, 3, "1", "1")
	return p, m, state, layout
}
func TestLiabilityStorageConservation(t *testing.T) {
	p, m, state, _ := liabilityFixture(t)
	result, e := matchLiabilityStorage(p, m, state)
	if e != nil || !result.BucketsMatched || !result.TotalsMatched || len(result.Changes) != 10 {
		t.Fatal(result, e)
	}
	if result.Changes[0].Delta != "-3" || result.Changes[5].Delta != "300" || result.Changes[3].ValuesObserved || result.Changes[3].Before != "" || !result.Changes[4].ValuesObserved {
		t.Fatal(result)
	}
	for _, mode := range []string{"missing-total", "wrong-total", "wrong-buckets", "platform-change", "unobserved-holder-change", "missing-role", "event-total", "wrong-code", "native-quote"} {
		t.Run(mode, func(t *testing.T) {
			p, m, state, layout := liabilityFixture(t)
			total, _ := liabilityStorageSlot(layout.TotalSlot, "", p.Candidate.State.MemeToken, nil)
			slot := func(b uint8) string {
				s, e := liabilityStorageSlot(layout.BucketSlot, m.MarketID, p.Candidate.State.MemeToken, &b)
				if e != nil {
					t.Fatal(e)
				}
				return s
			}
			switch mode {
			case "missing-total":
				delete(state.Prestate[p.To].Storage, total)
			case "wrong-total":
				state.Diff.Post[p.To].Storage[total] = "0x" + eventWord("60")
			case "wrong-buckets": // Conserve total but debit the wrong role.
				state.Diff.Post[p.To].Storage[slot(0)] = "0x" + eventWord("8")
				state.Diff.Post[p.To].Storage[slot(1)] = "0x" + eventWord("31")
			case "platform-change":
				state.Diff.Post[p.To].Storage[slot(2)] = "0x" + eventWord("1")
			case "unobserved-holder-change":
				delete(state.Prestate[p.To].Storage, slot(3))
				state.Diff.Post[p.To].Storage[slot(3)] = "0x" + eventWord("2")
			case "missing-role":
				delete(state.Prestate[p.To].Storage, slot(1))
			case "event-total":
				m.MemeSpent = "4"
			case "wrong-code":
				p.Candidate.State.FeeVaultRuntimeCodeHash = ""
			case "native-quote":
				p.Candidate.State.QuoteAsset = "0x0000000000000000000000000000000000000000" // different asset cannot reuse old slots
			}
			if _, e := matchLiabilityStorage(p, m, state); e == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}

func TestLiabilitySlotCastVectors(t *testing.T) {
	market, asset := "0x"+strings.Repeat("11", 32), "0x"+strings.Repeat("22", 20)
	bucket := uint8(3)
	got, e := liabilityStorageSlot("18", market, asset, &bucket)
	if e != nil || got != "0x6f9a43b5cebc9a4f295464934e784dc953c200cddc50ba74c13a00760c08908d" {
		t.Fatal(got, e)
	}
	got, e = liabilityStorageSlot("21", "", asset, nil)
	if e != nil || got != "0x083e3f53ec44112e112e92296ac45b813617b9dc6edb6f7756c2f421252142cd" {
		t.Fatal(got, e)
	}
}

func TestLiabilityStorageSingleRole(t *testing.T) {
	for _, creator := range []bool{true, false} {
		p, m, state, layout := liabilityFixture(t)
		if creator {
			m.Items[1].CreatorEpoch = 2
		} else {
			m.Items[0].CreatorEpoch = 0
		}
		for _, asset := range []string{p.Candidate.State.MemeToken, p.Candidate.State.QuoteAsset} {
			for b := uint8(0); b < 2; b++ {
				slot, e := liabilityStorageSlot(layout.BucketSlot, m.MarketID, asset, &b)
				if e != nil {
					t.Fatal(e)
				}
				selected := (creator && b == 0) || (!creator && b == 1)
				if !selected {
					delete(state.Prestate[p.To].Storage, slot)
					delete(state.Diff.Pre[p.To].Storage, slot)
					delete(state.Diff.Post[p.To].Storage, slot)
					continue
				}
				before, after := "a", "7"
				if asset == p.Candidate.State.QuoteAsset {
					before, after = "0", "12c"
				}
				state.Prestate[p.To].Storage[slot] = "0x" + eventWord(before)
				state.Diff.Pre[p.To].Storage[slot] = "0x" + eventWord(before)
				state.Diff.Post[p.To].Storage[slot] = "0x" + eventWord(after)
				if before == "0" {
					delete(state.Diff.Pre[p.To].Storage, slot)
				}
			}
		}
		if _, e := matchLiabilityStorage(p, m, state); e != nil {
			t.Fatal(creator, e)
		}
	}
}
