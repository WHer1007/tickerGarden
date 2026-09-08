package rewards

import (
	"fmt"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
)

func convWord(s string) string {
	s = strings.TrimPrefix(s, "0x")
	return strings.Repeat("0", 64-len(s)) + s
}
func convLog(index uint64, topic0, market, user string, epoch, spent, received string, batch bool) projection.Input {
	topics := []string{topic0, "0x" + convWord(market)}
	data := ""
	if batch {
		topics = append(topics, "0x"+convWord(epoch))
		data = "0x" + convWord("3333333333333333333333333333333333333333") + convWord("2222222222222222222222222222222222222222") + convWord(spent) + convWord(received)
	} else {
		topics = append(topics, "0x"+convWord(user), "0x"+convWord(epoch))
		data = "0x" + convWord(spent) + convWord(received)
	}
	return projection.Input{ChainID: 1, Module: "ProtocolFeeVault", Log: chainrpc.Log{Address: "0x" + strings.Repeat("9", 40), BlockHash: "0x" + strings.Repeat("a", 64), BlockNumber: "0x10", TransactionHash: "0x" + strings.Repeat("b", 64), LogIndex: fmt.Sprintf("0x%x", index), Topics: topics, Data: data}}
}

func TestConversionBatchesValidConservation(t *testing.T) {
	m := strings.Repeat("1", 64)
	u := strings.Repeat("4", 40)
	route := deployment.StateObservation{Kind: "canonicalRoute", Key: "0x" + m, Value: map[string]any{"launchPhase": "1", "memeToken": "0x" + strings.Repeat("3", 40), "quoteAsset": "0x" + strings.Repeat("2", 40)}}
	i := convLog(1, "0x536d8aaaf2bd3a634add9a0cbb15879e5cd81e4ef97a16fe231d48974e4c49d2", m, u, "1", "5", "3", false)
	second := convLog(2, "0x536d8aaaf2bd3a634add9a0cbb15879e5cd81e4ef97a16fe231d48974e4c49d2", m, u, "0", "7", "b", false)
	b := convLog(3, "0x426c15483c6ec6406a71c28295cfba9e4798dc18360d4c6f13cf7cf4ba6ee811", m, u, "1", "c", "e", true)
	got, err := ConversionBatches([]projection.Input{i, second, b}, []deployment.StateObservation{route})
	if err != nil || len(got) != 1 {
		t.Fatal(err, got)
	}
	if got[0].Value["itemCount"] != "2" || got[0].Value["memeSpent"] != "12" || got[0].Value["quoteReceived"] != "14" || got[0].Value["historyComplete"] != false {
		t.Fatal(got)
	}
}

func TestConversionBatchesRejectsInconsistentStreams(t *testing.T) {
	m := strings.Repeat("1", 64)
	u := strings.Repeat("4", 40)
	topicItem := "0x536d8aaaf2bd3a634add9a0cbb15879e5cd81e4ef97a16fe231d48974e4c49d2"
	topicBatch := "0x426c15483c6ec6406a71c28295cfba9e4798dc18360d4c6f13cf7cf4ba6ee811"
	route := deployment.StateObservation{Kind: "canonicalRoute", Key: "0x" + m, Value: map[string]any{"memeToken": "0x" + strings.Repeat("3", 40), "quoteAsset": "0x" + strings.Repeat("2", 40)}}
	valid := func() []projection.Input {
		return []projection.Input{convLog(1, topicItem, m, u, "1", "5", "3", false), convLog(2, topicBatch, m, u, "1", "5", "3", true)}
	}
	for _, name := range []string{"mismatch", "orphan", "empty batch", "cross transaction", "duplicate user epoch", "asset mismatch", "duplicate nonce"} {
		t.Run(name, func(t *testing.T) {
			in := valid()
			switch name {
			case "mismatch":
				in[1] = convLog(2, topicBatch, m, u, "1", "6", "3", true)
			case "orphan":
				in = in[:1]
			case "empty batch":
				in = in[1:]
			case "cross transaction":
				in[1].Log.TransactionHash = "0x" + strings.Repeat("c", 64)
			case "duplicate user epoch":
				in = []projection.Input{in[0], convLog(2, topicItem, m, u, "1", "1", "1", false), convLog(3, topicBatch, m, u, "1", "6", "4", true)}
			case "asset mismatch":
				in[1] = convLog(2, topicBatch, m, u, "1", "5", "3", true)
				in[1].Log.Data = "0x" + convWord("4") + convWord("2") + convWord("5") + convWord("3")
			case "duplicate nonce":
				in = append(in, convLog(3, topicItem, m, u, "1", "5", "3", false), convLog(4, topicBatch, m, u, "1", "5", "3", true))
			}
			if _, err := ConversionBatches(in, []deployment.StateObservation{route}); err == nil {
				t.Fatal("accepted invalid stream")
			}
		})
	}
	t.Run("over 32 items", func(t *testing.T) {
		in := []projection.Input{}
		for i := 1; i <= 33; i++ {
			in = append(in, convLog(uint64(i), topicItem, m, u, fmt.Sprintf("%x", i), "1", "1", false))
		}
		in = append(in, convLog(34, topicBatch, m, u, "1", "21", "21", true))
		if _, err := ConversionBatches(in, []deployment.StateObservation{route}); err == nil {
			t.Fatal("accepted overlong batch")
		}
		valid := append([]projection.Input{}, in[:32]...)
		valid = append(valid, convLog(33, topicBatch, m, u, "1", "20", "20", true))
		if got, err := ConversionBatches(valid, []deployment.StateObservation{route}); err != nil || len(got) != 1 {
			t.Fatal("valid 32-item prefix failed", err)
		}

	})
}
