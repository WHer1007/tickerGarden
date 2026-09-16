package readmodel

import "testing"

func TestHolderEpochSchedule(t *testing.T) {
	for _, mode := range []string{"valid", "at boundary", "before boundary", "wrong current", "wrong start", "wrong end", "early request", "future request", "future current request", "overflow", "zero duration", "zero epoch", "noncanonical"} {
		t.Run(mode, func(t *testing.T) {
			now := uint64(101)
			epoch := &EpochHolderCandidate{ActivatedAt: "1", EpochDuration: "100", CurrentEpoch: "2", Entries: []HolderEpochDetail{{Epoch: "1", Values: map[string]string{"windowstart": "1", "windowend": "101", "status": "1", "requestedAt": "101"}}}}
			v := epoch.Entries[0].Values
			switch mode {
			case "at boundary":
				v["status"] = "0"
				v["requestedAt"] = "0"
			case "before boundary":
				now = 100
				epoch.CurrentEpoch = "1"
				v["status"] = "0"
				v["requestedAt"] = "0"
			case "wrong current":
				epoch.CurrentEpoch = "1"
			case "wrong start":
				v["windowstart"] = "2"
			case "wrong end":
				v["windowend"] = "100"
			case "early request":
				v["requestedAt"] = "100"
			case "future request":
				v["requestedAt"] = "102"
			case "future current request":
				epoch.Entries[0].Epoch = "2"
				v["windowstart"] = "101"
				v["windowend"] = "201"
			case "overflow":
				now = 18446744073709551615
				epoch.ActivatedAt = "18446744073709551615"
				epoch.CurrentEpoch = "1"
			case "zero duration":
				epoch.EpochDuration = "0"
			case "zero epoch":
				epoch.Entries[0].Epoch = "0"
			case "noncanonical":
				epoch.EpochDuration = "0100"
			}
			valid := mode == "valid" || mode == "at boundary" || mode == "before boundary"
			if e := verifyHolderEpochSchedule(epoch, now); (e == nil) != valid {
				t.Fatal(mode, e)
			}
		})
	}
}
