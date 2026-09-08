package settlement

import (
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
)

func previewRequest(total string, items ...Item) Request {
	return Request{TotalMeme: total, Items: items}
}

func TestConversionAllocationsMirrorsCumulativeFloor(t *testing.T) {
	u1 := "0x0000000000000000000000000000000000000001"
	u2 := "0x0000000000000000000000000000000000000002"
	got, err := conversionAllocations(previewRequest("20",
		Item{User: u1, CreatorEpoch: 7, MaximumMeme: "7"},
		Item{User: u2, CreatorEpoch: 13, MaximumMeme: "13"}), "1", "11", "101")
	if err != nil {
		t.Fatal(err)
	}
	want := []ConversionAllocation{
		{User: u1, CreatorEpoch: 7, MemeSpent: "3", MemeRefund: "4", QuoteReceived: "27"},
		{User: u2, CreatorEpoch: 13, MemeSpent: "8", MemeRefund: "5", QuoteReceived: "74"},
	}
	if len(got) != len(want) {
		t.Fatalf("rows = %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("row %d = %#v, want %#v", i, got[i], want[i])
		}
	}
}

func TestConversionAllocationsRejectsInvalidSimulationInputs(t *testing.T) {
	r := previewRequest("20", Item{MaximumMeme: "20"})
	for name, values := range map[string][3]string{
		"zero spent":      {"0", "1", "1"},
		"over total":      {"21", "1", "1"},
		"below minimum":   {"20", "9", "10"},
		"malformed spent": {"11x", "101", "1"},
		"trailing uint":   {"11", "1010 ", "1"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := conversionAllocations(r, values[2], values[0], values[1]); err != ErrSimulation {
				t.Fatalf("err = %v, want ErrSimulation", err)
			}
		})
	}
	if _, err := conversionAllocations(previewRequest("20", Item{MaximumMeme: "7"}), "1", "11", "101"); err != ErrSimulation {
		t.Fatalf("sum mismatch err = %v", err)
	}
	if _, err := conversionAllocations(previewRequest("100", Item{MaximumMeme: "50"}, Item{MaximumMeme: "50"}), "1", "100", "1"); err != ErrSimulation {
		t.Fatalf("zero payout err = %v", err)
	}
}

func TestConversionAllocationsAcceptsFullSpend(t *testing.T) {
	got, err := conversionAllocations(previewRequest("20", Item{MaximumMeme: "7"}, Item{MaximumMeme: "13"}), "100", "20", "100")
	if err != nil {
		t.Fatal(err)
	}
	if got[0].MemeSpent != "7" || got[1].MemeSpent != "13" || got[0].MemeRefund != "0" || got[1].MemeRefund != "0" {
		t.Fatalf("full spend = %#v", got)
	}
}

func TestConversionDataUsesExplicitABIOffsets(t *testing.T) {
	market := "0x" + strings.Repeat("ab", 32)
	b := Batch{MarketID: market, MinimumQuote: "9", Deadline: 17, Items: []Item{{User: "0x0000000000000000000000000000000000000001", CreatorEpoch: 3, MaximumMeme: "5"}}}
	data, err := conversionData(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) != 10+64*8 {
		t.Fatalf("data length = %d, want %d", len(data), 10+64*8)
	}
	word := func(i int) string { return data[10+i*64 : 10+(i+1)*64] }
	if word(0) != market[2:] || word(1) != fmt.Sprintf("%064x", 128) || word(2) != fmt.Sprintf("%064x", 9) || word(3) != fmt.Sprintf("%064x", 17) || word(4) != fmt.Sprintf("%064x", 1) {
		t.Fatalf("head words malformed: %q %q %q %q %q", word(0), word(1), word(2), word(3), word(4))
	}
	if _, err := hex.DecodeString(data[10:]); err != nil {
		t.Fatal(err)
	}
}
