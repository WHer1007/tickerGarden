package deployment

import (
	"context"
	"fmt"
	"testing"
)

func TestTreasuryPendingEpochTimingAndCommitments(t *testing.T) {
	for _, tc := range []struct {
		name  string
		now   uint64
		empty bool
	}{
		{"nonempty before finalize", 605049, false},
		{"nonempty at finalize", 605050, false},
		{"nonempty after finalize", 605100, false},
		{"nonempty after publish deadline", 605201, false},
		{"empty rollover", 605100, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, b, id, d, key := requestSetup(t)
			f.now, b.Timestamp = tc.now, fmt.Sprintf("0x%x", tc.now)
			putPending := func(index int, value string) {
				copy(f.calls[key][index*32:(index+1)*32], bytesWord(value))
			}
			putPending(6, "2")
			putPending(2, fmt.Sprintf("%x", 605050))
			putPending(3, "0")
			if tc.empty {
				putPending(5, "0")
				putPending(15, "0")
				putPending(11, Hash([]byte("TICKERGARDEN_V1_TREASURY_EMPTY_EPOCH_V1")))
			} else {
				putPending(5, "3")
				putPending(15, "64")
				putPending(11, blockHash)
			}
			got, err := ObserveTreasuryPendingEpoch(context.Background(), f, f.manifest, b, id, 1)
			if err != nil || got.BlockHash != blockHash || got.Distributor != d {
				t.Fatalf("pending epoch rejected: %v", err)
			}
		})
	}
}

func TestTreasuryPendingEpochRejectsMalformedCommitment(t *testing.T) {
	for _, name := range []string{"partial empty leaf", "partial empty twab", "bad root", "bad dataset", "claimUntil", "claimed", "status", "funding", "source", "reorg"} {
		t.Run(name, func(t *testing.T) {
			f, b, id, d, key := requestSetup(t)
			put := func(index int, value string) {
				copy(f.calls[key][index*32:(index+1)*32], bytesWord(value))
			}
			put(6, "2")
			put(2, fmt.Sprintf("%x", 605050))
			put(3, "0")
			put(5, "3")
			put(15, "64")
			put(11, blockHash)
			switch name {
			case "partial empty leaf":
				put(5, "0")
			case "partial empty twab":
				put(15, "0")
			case "bad root":
				put(11, "0")
			case "bad dataset":
				put(12, "0")
			case "claimUntil":
				put(3, "1")
			case "claimed":
				put(14, "1")
			case "status":
				put(6, "1")
			case "funding":
				args := id[2:] + fmt.Sprintf("%064x", 1)
				f.calls[d+Hash([]byte("epochQuoteAmount(bytes32,uint32)"))[:10]+args] = bytesWord("b")
			case "source":
				put(4, "605100")
			case "reorg":
				f.lateReorg = true
			}
			got, err := ObserveTreasuryPendingEpoch(context.Background(), f, f.manifest, b, id, 1)
			if err == nil || got.BlockHash != "" {
				t.Fatal("malformed pending epoch accepted", got, err)
			}
		})
	}
}
