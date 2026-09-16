package readmodel

import (
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestHolderEpochLifecycle(t *testing.T) {
	zero := "0x0000000000000000000000000000000000000000000000000000000000000000"
	hash := deployment.Hash([]byte("test root"))
	for _, mode := range []string{"requested", "pending future", "pending overdue", "claiming", "claiming expired", "rollover", "empty pending", "empty rollover", "requested root", "requested claim", "pending claim", "early finalize", "early rollover", "zero requester", "zero fee", "zero commitment", "wrong empty root", "empty claiming", "mixed empty", "cleared dirty"} {
		t.Run(mode, func(t *testing.T) {
			v := map[string]string{"status": "1", "requestedAt": "10", "publishBy": "20", "finalizeAfter": "0", "claimUntil": "0", "requester": "0x1111111111111111111111111111111111111111", "serviceFeeAmount": "1", "quoteAmount": "10", "claimedAmount": "0", "totalTwab": "0", "leafCount": "0", "merkleRoot": zero, "datasetHash": zero}
			now := uint64(100)
			if mode != "requested" && mode != "requested root" && mode != "requested claim" && mode != "cleared dirty" {
				v["status"] = "2"
				v["finalizeAfter"] = "110"
				v["merkleRoot"] = hash
				v["datasetHash"] = hash
				v["totalTwab"] = "20"
				v["leafCount"] = "1"
			}
			switch mode {
			case "pending overdue":
				v["finalizeAfter"] = "30"
			case "claiming", "claiming expired", "rollover", "early rollover", "early finalize":
				v["status"] = "3"
				v["finalizeAfter"] = "30"
				v["claimUntil"] = "80"
				v["claimedAmount"] = "2"
				if mode == "claiming" {
					v["claimUntil"] = "120"
				}
				if mode == "rollover" || mode == "early rollover" {
					v["status"] = "4"
				}
				if mode == "early rollover" {
					v["claimUntil"] = "100"
				}
				if mode == "early finalize" {
					v["finalizeAfter"] = "110"
					v["claimUntil"] = "120"
				}
			case "empty pending", "empty rollover", "wrong empty root", "empty claiming":
				v["totalTwab"] = "0"
				v["leafCount"] = "0"
				v["merkleRoot"] = deployment.Hash([]byte("TICKERGARDEN_V1_TREASURY_EMPTY_EPOCH_V1"))
				if mode == "empty rollover" {
					v["status"] = "4"
					v["finalizeAfter"] = "30"
				}
				if mode == "wrong empty root" {
					v["merkleRoot"] = hash
				}
				if mode == "empty claiming" {
					v["status"] = "3"
					v["finalizeAfter"] = "30"
				}
			case "requested root":
				v["merkleRoot"] = hash
			case "requested claim", "pending claim":
				v["claimedAmount"] = "1"
			case "zero requester":
				v["requester"] = "0x0000000000000000000000000000000000000000"
			case "zero fee":
				v["serviceFeeAmount"] = "0"
			case "zero commitment":
				v["quoteAmount"] = "0"
			case "mixed empty":
				v["leafCount"] = "0"
			case "cleared dirty":
				v["status"] = "0"
			}
			valid := mode == "requested" || mode == "pending future" || mode == "pending overdue" || mode == "claiming" || mode == "claiming expired" || mode == "rollover" || mode == "empty pending" || mode == "empty rollover"
			if e := verifyHolderEpochLifecycle(v, now); (e == nil) != valid {
				t.Fatal(mode, e)
			}
		})
	}
}
