package deployment

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"testing"
)

func creatorExitCall(vault, id, beneficiary string) string {
	return vault + Hash([]byte("rawRewardExitAt(bytes32,address)"))[:10] + id[2:] + addressArgument(beneficiary)
}

func creatorEpochRows(batch ObservationBatch) map[string]StateObservation {
	rows := map[string]StateObservation{}
	for _, row := range batch.Observations {
		if row.Kind == "creatorEpoch" {
			rows[row.Key] = row
		}
	}
	return rows
}

func TestCreatorEpochExitObservationTiming(t *testing.T) {
	for _, tc := range []struct {
		name, exitAt, expected string
		ready                  bool
	}{
		{"zero", "0", "0", false},
		{"future", "65", "101", false},
		{"exact block time", "64", "100", true},
		{"past", "63", "99", true},
		{"huge uint256", strings.Repeat("f", 64), new(big.Int).SetUint64(0).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)).String(), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, b, markets, vault, _ := feeSetup(t, true)
			var id string
			for key := range markets {
				id = key
			}
			beneficiary := markets[id].State["creatorRevenueBeneficiaryAtCreation"].(string)
			f.calls[creatorExitCall(vault, id, beneficiary)] = bytesWord(tc.exitAt)
			batch, err := ObserveFeeBlock(context.Background(), f, f.manifest, b, markets)
			if err != nil {
				t.Fatal(err)
			}
			row, ok := creatorEpochRows(batch)[fmt.Sprintf("%s:1", id)]
			if !ok || row.Value["rawRewardExitAt"] != tc.expected || row.Value["rawRewardExitReady"] != tc.ready || row.Value["observedAtTimestamp"] != "100" {
				t.Fatalf("unexpected exit observation: %#v", row)
			}
		})
	}
}

func TestCreatorEpochExitStateIsScopedToBeneficiary(t *testing.T) {
	f, b, markets, vault, _ := feeSetup(t, true)
	var id string
	for key := range markets {
		id = key
	}
	first := markets[id].State["creatorRevenueBeneficiaryAtCreation"].(string)
	second := "0x" + strings.Repeat("7", 40)
	f.calls[creatorExitCall(vault, id, first)] = bytesWord("64")
	f.calls[creatorExitCall(vault, id, second)] = bytesWord("65")
	batch, err := ObserveFeeBlock(context.Background(), f, f.manifest, b, markets)
	if err != nil {
		t.Fatal(err)
	}
	rows := creatorEpochRows(batch)
	if rows[id+":1"].Value["rawRewardExitAt"] != "100" || rows[id+":1"].Value["rawRewardExitReady"] != true || rows[id+":2"].Value["rawRewardExitAt"] != "101" || rows[id+":2"].Value["rawRewardExitReady"] != false {
		t.Fatalf("beneficiary exit state was shared: %#v %#v", rows[id+":1"], rows[id+":2"])
	}
}

func TestCreatorEpochExitMissingGetterFailsClosed(t *testing.T) {
	f, b, markets, vault, _ := feeSetup(t, true)
	var id string
	for key := range markets {
		id = key
	}
	beneficiary := markets[id].State["creatorRevenueBeneficiaryAtCreation"].(string)
	delete(f.calls, creatorExitCall(vault, id, beneficiary))
	batch, err := ObserveFeeBlock(context.Background(), f, f.manifest, b, markets)
	if err == nil || batch.Scope != "" || len(batch.Observations) != 0 {
		t.Fatalf("expected empty failed batch: %#v, %v", batch, err)
	}
}

func TestCreatorEpochExitRejectsInvalidHeaderTimestamp(t *testing.T) {
	f, b, markets, _, _ := feeSetup(t, true)
	b.Timestamp = "0xnot-a-timestamp"
	batch, err := ObserveFeeBlock(context.Background(), f, f.manifest, b, markets)
	if err == nil || batch.Scope != "" || len(batch.Observations) != 0 {
		t.Fatalf("expected timestamp rejection: %#v, %v", batch, err)
	}
}
