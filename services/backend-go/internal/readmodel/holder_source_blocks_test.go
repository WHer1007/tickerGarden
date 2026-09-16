package readmodel

import (
	"strings"
	"testing"
)

func TestHolderSourceBlockInventory(t *testing.T) {
	for _, mode := range []string{"valid", "shared", "conflict", "none", "none with source", "requested zero hash", "height padding", "hash malformed", "overflow", "bad status", "missing request time"} {
		t.Run(mode, func(t *testing.T) {
			hash := "0x" + strings.Repeat("1", 64)
			zero := "0x" + strings.Repeat("0", 64)
			values := map[string]string{"status": "3", "sourceBlockNumber": "10", "sourceBlockHash": hash, "requestedAt": "100"}
			h := HolderMarketCandidate{Mode: "epoch", Epoch: &EpochHolderCandidate{Entries: []HolderEpochDetail{{Values: values}}}}
			switch mode {
			case "shared":
				h.Epoch.Entries = append(h.Epoch.Entries, h.Epoch.Entries[0])
			case "conflict":
				h.Epoch.Entries = append(h.Epoch.Entries, HolderEpochDetail{Values: map[string]string{"status": "4", "sourceBlockNumber": "10", "sourceBlockHash": "0x" + strings.Repeat("2", 64), "requestedAt": "100"}})
			case "none":
				values["status"] = "0"
				values["sourceBlockNumber"] = "0"
				values["sourceBlockHash"] = zero
				values["requestedAt"] = "0"
			case "none with source":
				values["status"] = "0"
			case "requested zero hash":
				values["sourceBlockHash"] = zero
			case "height padding":
				values["sourceBlockNumber"] = "010"
			case "hash malformed":
				values["sourceBlockHash"] = "0x12"
			case "overflow":
				values["sourceBlockNumber"] = "9223372036854775808"
			case "bad status":
				values["status"] = "5"
			case "missing request time":
				values["status"] = "0"
				values["sourceBlockNumber"] = "0"
				values["sourceBlockHash"] = zero
				delete(values, "requestedAt")
			}
			got, e := holderSourceBlocks([]HolderMarketCandidate{h})
			valid := mode == "valid" || mode == "shared" || mode == "none"
			if (e == nil) != valid {
				t.Fatal(mode, e)
			}
			if valid && mode != "none" && (len(got) != 1 || got[10] != hash) {
				t.Fatal(got)
			}
			if mode == "none" && len(got) != 0 {
				t.Fatal(got)
			}
		})
	}
}
