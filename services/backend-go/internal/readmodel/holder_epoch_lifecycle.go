package readmodel

import (
	"errors"
	"strconv"
	"tickergarden/backend/internal/deployment"
)

// Values have passed holderEpochDetails' type, range and funding checks.
func verifyHolderEpochLifecycle(v map[string]string, timestamp uint64) error {
	bad := errors.New("Holder epoch state contradicts Treasury lifecycle")
	zeroHash := "0x0000000000000000000000000000000000000000000000000000000000000000"
	zeroAddress := "0x0000000000000000000000000000000000000000"
	emptyRoot := deployment.Hash([]byte("TICKERGARDEN_V1_TREASURY_EMPTY_EPOCH_V1"))
	getTime := func(k string) uint64 { n, _ := strconv.ParseUint(v[k], 10, 64); return n }
	status := v["status"]
	if status == "0" {
		for _, key := range []string{"requestedAt", "publishBy", "finalizeAfter", "claimUntil", "sourceBlockNumber", "leafCount", "serviceFeeAmount", "quoteAmount", "claimedAmount", "totalTwab"} {
			if v[key] != "0" {
				return bad
			}
		}
		for _, key := range []string{"sourceBlockHash", "merkleRoot", "datasetHash"} {
			if v[key] != zeroHash {
				return bad
			}
		}
		if v["requester"] != zeroAddress || v["serviceFeeAsset"] != zeroAddress {
			return bad
		}
		return nil
	}
	if status != "1" && status != "2" && status != "3" && status != "4" {
		return bad
	}
	requested, publish, finalize, claim := getTime("requestedAt"), getTime("publishBy"), getTime("finalizeAfter"), getTime("claimUntil")
	if requested == 0 || requested > timestamp || publish <= requested || v["requester"] == zeroAddress || v["serviceFeeAmount"] == "0" || v["quoteAmount"] == "0" {
		return bad
	}
	if status == "1" {
		if finalize != 0 || claim != 0 || v["claimedAmount"] != "0" || v["leafCount"] != "0" || v["totalTwab"] != "0" || v["merkleRoot"] != zeroHash || v["datasetHash"] != zeroHash {
			return bad
		}
		return nil
	}
	if finalize <= requested || v["datasetHash"] == zeroHash || v["merkleRoot"] == zeroHash {
		return bad
	}
	empty := v["totalTwab"] == "0" && v["leafCount"] == "0"
	if empty {
		if v["merkleRoot"] != emptyRoot || v["claimedAmount"] != "0" {
			return bad
		}
	} else if v["totalTwab"] == "0" || v["leafCount"] == "0" {
		return bad
	}
	if status == "2" {
		if claim != 0 || v["claimedAmount"] != "0" {
			return bad
		}
		return nil
	}
	if finalize > timestamp {
		return bad
	}
	if empty {
		if status != "4" || claim != 0 {
			return bad
		}
		return nil
	}
	if claim <= finalize {
		return bad
	}
	if status == "4" && timestamp <= claim {
		return bad
	}
	return nil
}
