package settlement

import (
	"encoding/json"
	"math/big"
	"os"
	"reflect"
	"testing"
)

type gaugePositionVector struct {
	Name      string                `json:"name"`
	Before    gaugePositionState    `json:"before"`
	Snapshot  gaugeSnapshotState    `json:"snapshot"`
	Bucket    gaugeActivationBucket `json:"bucket"`
	Current   [2]string             `json:"current"`
	Timestamp uint64                `json:"timestamp"`
	Maximum   string                `json:"maximum"`
	Refund    string                `json:"refund"`
	Quote     string                `json:"quote"`
	Expected  gaugePositionReplay   `json:"expected"`
}

func gaugePositionVectors(t *testing.T) []gaugePositionVector {
	t.Helper()
	body, e := os.ReadFile("testdata/gauge-position.json")
	if e != nil {
		t.Fatal(e)
	}
	var v []gaugePositionVector
	if json.Unmarshal(body, &v) != nil {
		t.Fatal("vectors")
	}
	return v
}
func TestGaugePositionSolidityVectors(t *testing.T) {
	for _, c := range gaugePositionVectors(t) {
		t.Run(c.Name, func(t *testing.T) {
			got, e := replayGaugePosition(c.Before, c.Snapshot, c.Bucket, c.Current, c.Timestamp, c.Maximum, c.Refund, c.Quote)
			if e != nil || !reflect.DeepEqual(got, c.Expected) {
				t.Fatalf("got %+v expected %+v: %v", got, c.Expected, e)
			}
		})
	}
}
func TestGaugePositionRefusesInvalidState(t *testing.T) {
	for _, mode := range []string{"regression", "remainder", "pending-generation", "missing-bucket", "snapshot-refs", "snapshot-conflict", "overflow", "refund", "zero-pull"} {
		t.Run(mode, func(t *testing.T) {
			c := gaugePositionVectors(t)[0]
			switch mode {
			case "regression":
				c.Before.Rewards[1].Paid = "1000000000000000000000000001"
			case "remainder":
				c.Before.Rewards[0].Remainder = gaugePrecision().String()
			case "pending-generation":
				c.Before.Generation = 12
			case "missing-bucket":
				c.Before.Pending = "2"
				c.Before.Generation = 90
			case "snapshot-refs":
				c.Before.Pending = "2"
				c.Before.Generation = 90
				c.Snapshot.Processed = true
			case "snapshot-conflict":
				c.Before.Pending = "2"
				c.Before.Generation = 90
				c.Snapshot.Refs = "1"
				c.Bucket = gaugeActivationBucket{Generation: 90, Amount: "2", Refs: "1"}
			case "overflow":
				c.Before.Rewards[0].Pending = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)).String()
			case "refund":
				c.Refund = "6"
			case "zero-pull":
				c.Before.Active = "0"
				c.Before.Rewards[1].Pending = "0"
			}
			if _, e := replayGaugePosition(c.Before, c.Snapshot, c.Bucket, c.Current, c.Timestamp, c.Maximum, c.Refund, c.Quote); e == nil {
				t.Fatal("accepted", mode)
			}
		})
	}
}
