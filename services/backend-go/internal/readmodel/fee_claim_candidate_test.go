package readmodel

import (
	"encoding/json"
	"math/big"
	"os"
	"strconv"
	"strings"
	"testing"

	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

func TestFeeClaimCandidateFromEventReplay(t *testing.T) {
	data, err := os.ReadFile("../projection/testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct{ Input projection.Input }
	if json.Unmarshal(data, &fixtures) != nil {
		t.Fatal("golden JSON")
	}
	for _, fixture := range fixtures {
		input := fixture.Input
		decoded, e := events.Decode(input.Module, input.Log)
		if e != nil || !strings.HasPrefix(decoded.Signature, "FeeClaimed(") {
			continue
		}
		state := projection.New()
		for _, index := range []string{"0x0", "0x1"} {
			input.Log.LogIndex = index
			if _, e = state.Apply(input); e != nil {
				t.Fatal(e)
			}
		}
		raw, e := state.Snapshot()
		if e != nil {
			t.Fatal(e)
		}
		var snapshot struct {
			Tables map[string]map[string]json.RawMessage
		}
		if json.Unmarshal(raw, &snapshot) != nil {
			t.Fatal("projection JSON")
		}
		height, e := strconv.ParseUint(input.Log.BlockNumber, 0, 64)
		if e != nil {
			t.Fatal(e)
		}
		marketID := decoded.Args["marketId"].(string)
		asset := decoded.Args["feeAsset"].(string)
		c := CandidateSet{ChainID: input.ChainID, BlockNumber: strconv.FormatUint(height, 10), BlockHash: input.Log.BlockHash, Markets: []MarketReadModel{{MarketID: marketID, QuoteAsset: asset, MemeToken: "0x" + strings.Repeat("9", 40)}}}
		rows := snapshot.Tables["feeClaimTotals"]
		result, e := buildFeeClaimCandidates(rows, c)
		if e != nil || len(result) != 1 || result[0].ClaimCount != "2" || result[0].Source.LogIndex != 1 {
			t.Fatal("replayed claims", result, e)
		}
		amount, ok := new(big.Int).SetString(decoded.Args["amount"].(string), 10)
		if !ok || result[0].ClaimedAmount != amount.Mul(amount, big.NewInt(2)).String() {
			t.Fatal("claim amount not accumulated")
		}
		for _, mode := range []string{"unknown market", "wrong chain", "future source", "count", "amount", "key"} {
			t.Run(mode, func(t *testing.T) {
				copyRows := map[string]json.RawMessage{}
				for key, data := range rows {
					var row map[string]any
					if json.Unmarshal(data, &row) != nil {
						t.Fatal("row")
					}
					values := row["values"].(map[string]any)
					source := row["provenance"].(map[string]any)
					switch mode {
					case "unknown market":
						values["marketId"] = "0x" + strings.Repeat("f", 64)
					case "wrong chain":
						source["chainId"] = 1
					case "future source":
						source["blockNumber"] = "99999999"
					case "count":
						values["claimCount"] = "0"
					case "amount":
						values["claimedAmount"] = "-1"
					case "key":
						key = "wrong"
					}
					raw, e := json.Marshal(row)
					if e != nil {
						t.Fatal(e)
					}
					copyRows[key] = raw
				}
				if value, e := buildFeeClaimCandidates(copyRows, c); e == nil || value != nil {
					t.Fatal("inconsistent history accepted", value)
				}
			})
		}
		return
	}
	t.Fatal("FeeClaimed fixture missing")
}
