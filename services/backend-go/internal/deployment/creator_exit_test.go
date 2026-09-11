package deployment

import (
	"context"
	"strings"
	"testing"
)

func creatorEpochRows(batch ObservationBatch) map[string]StateObservation {
	rows := map[string]StateObservation{}
	for _, row := range batch.Observations {
		if row.Kind == "creatorEpoch" {
			rows[row.Key] = row
		}
	}
	return rows
}

func TestCreatorEpochsNeedNoRawExitGetter(t *testing.T) {
	f, b, markets, vault, _ := feeSetup(t, true)
	for key := range f.calls {
		if strings.HasPrefix(key, vault+Hash([]byte("rawRewardExitAt(bytes32,address)"))[:10]) {
			delete(f.calls, key)
		}
	}
	batch, err := ObserveFeeBlock(context.Background(), f, f.manifest, b, markets)
	if err != nil {
		t.Fatal(err)
	}
	rows := creatorEpochRows(batch)
	if len(rows) != 2 {
		t.Fatal("missing epochs", rows)
	}
	owners := map[any]bool{}
	for _, row := range rows {
		if _, ok := row.Value["rawRewardExitAt"]; ok {
			t.Fatal("retired field")
		}
		if _, ok := row.Value["rawRewardExitReady"]; ok {
			t.Fatal("retired field")
		}
		if row.Value["observedAtTimestamp"] != "100" {
			t.Fatal("unpinned observation")
		}
		owners[row.Value["beneficiary"]] = true
	}
	if len(owners) != 2 {
		t.Fatal("epoch owners were combined")
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
