package readmodel

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"tickergarden/backend/internal/projection"
)

func TestCandidateInventoryRequiresEveryKnownEvent(t *testing.T) {
	raw, e := os.ReadFile("../projection/testdata/golden.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures []struct{ Input projection.Input }
	if e = json.Unmarshal(raw, &fixtures); e != nil {
		t.Fatal(e)
	}
	original := fixtures[0].Input
	for _, mode := range []string{"present", "missing", "wrong module", "other block", "other index", "malformed known event", "unknown topic", "unbound address", "before creation"} {
		t.Run(mode, func(t *testing.T) {
			log := original.Log
			log.Topics = append([]string(nil), log.Topics...)
			guard := &candidateEmitterBindings{addresses: map[string]emitterBinding{log.Address: {module: original.Module, from: 10}}}
			key := log.BlockHash + ":" + log.LogIndex
			inputs := map[string]string{key: original.Module}
			switch mode {
			case "missing":
				delete(inputs, key)
			case "wrong module":
				inputs[key] = "UserStockVault"
			case "other block":
				log.BlockHash = "0x" + strings.Repeat("9", 64)
			case "other index":
				log.LogIndex = "0xff"
			case "malformed known event":
				log.Data = "0x"
			case "unknown topic":
				log.Topics[0] = "0x" + strings.Repeat("9", 64)
				delete(inputs, key)
			case "unbound address":
				log.Address = "0x" + strings.Repeat("9", 40)
				delete(inputs, key)
			case "before creation":
				log.BlockNumber = "0x9"
			}
			e := guard.requireInput(log, inputs)
			valid := mode == "present" || mode == "unknown topic" || mode == "unbound address"
			if (e == nil) != valid {
				t.Fatal(mode, e)
			}
		})
	}
}
