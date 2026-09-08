package rewards

import (
	"errors"
	"math/big"
	"strconv"
	"strings"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

// ConversionBatches verifies the item-to-batch conservation of authenticated,
// ordered logs from one complete block. It does not reconstruct requested maxima
// or refunds: those values are not present in these events.
func ConversionBatches(inputs []projection.Input, observations []deployment.StateObservation) ([]deployment.StateObservation, error) {
	fail := func() ([]deployment.StateObservation, error) {
		return nil, errors.New("inconsistent reward conversion events")
	}
	routes := map[string]map[string]any{}
	for _, r := range observations {
		if r.Kind == "canonicalRoute" {
			if _, ok := routes[r.Key]; ok {
				return fail()
			}
			routes[r.Key] = r.Value
		}
	}
	pending := map[string][]map[string]any{}
	result := []deployment.StateObservation{}
	var previous uint64
	var started bool
	var blockHash, blockNumber string
	var chain uint64
	nonces := map[string]bool{}
	for _, input := range inputs {
		log := input.Log
		index, e := chainrpc.Quantity(log.LogIndex)
		if e != nil {
			return fail()
		}
		if started && (index <= previous || log.BlockHash != blockHash || log.BlockNumber != blockNumber || input.ChainID != chain) {
			return fail()
		}
		previous, blockHash, blockNumber, chain, started = index, log.BlockHash, log.BlockNumber, input.ChainID, true
		event, e := events.Decode(input.Module, log)
		if e != nil {
			return fail()
		}
		if !strings.HasPrefix(event.Signature, "RewardConverted(") && !strings.HasPrefix(event.Signature, "RewardBatchConverted(") {
			continue
		}
		if input.Module != "ProtocolFeeVault" || log.Removed || !hash.MatchString(log.TransactionHash) {
			return fail()
		}
		a := event.Args
		market := text(a, "marketId")
		group := log.TransactionHash + ":" + log.Address + ":" + market
		eventKey := strconv.FormatUint(chain, 10) + ":" + log.TransactionHash + ":" + strconv.FormatUint(index, 10)
		if strings.HasPrefix(event.Signature, "RewardConverted(") {
			items := pending[group]
			if len(items) >= 32 {
				return fail()
			}
			user, epoch := text(a, "user"), text(a, "creatorEpoch")
			if user == "0x"+strings.Repeat("0", 40) {
				return fail()
			}
			for _, old := range items {
				if old["user"] == user && old["creatorEpoch"] == epoch {
					return fail()
				}
			}
			if (text(a, "memeSpent") == "0") != (text(a, "quoteReceived") == "0") {
				return fail()
			}
			pending[group] = append(items, map[string]any{"user": user, "creatorEpoch": epoch, "memeSpent": a["memeSpent"], "quoteReceived": a["quoteReceived"], "eventKey": eventKey, "logIndex": strconv.FormatUint(index, 10)})
			continue
		}
		items := pending[group]
		if len(items) == 0 {
			return fail()
		}
		route, ok := routes[market]
		if !ok || route["memeToken"] != a["memeAsset"] || route["quoteAsset"] != a["quoteAsset"] {
			return fail()
		}
		nonce := market + ":" + text(a, "nonce")
		if text(a, "nonce") == "0" || nonces[nonce] {
			return fail()
		}
		nonces[nonce] = true
		spent, received := new(big.Int), new(big.Int)
		for _, item := range items {
			m, _ := new(big.Int).SetString(text(item, "memeSpent"), 10)
			q, _ := new(big.Int).SetString(text(item, "quoteReceived"), 10)
			spent.Add(spent, m)
			received.Add(received, q)
		}
		if spent.Sign() == 0 || received.Sign() == 0 || spent.String() != text(a, "memeSpent") || received.String() != text(a, "quoteReceived") {
			return fail()
		}
		result = append(result, deployment.StateObservation{Kind: "rewardConversionBatch", Key: eventKey, Value: map[string]any{
			"marketId": market, "nonce": a["nonce"], "memeAsset": a["memeAsset"], "quoteAsset": a["quoteAsset"], "memeSpent": a["memeSpent"], "quoteReceived": a["quoteReceived"],
			"transactionHash": log.TransactionHash, "emitter": log.Address, "eventKey": eventKey, "items": items, "itemCount": strconv.Itoa(len(items)), "itemTotalsMatch": true, "historyComplete": false, "publicationEligible": false,
		}})
		delete(pending, group)
	}
	if len(pending) != 0 {
		return fail()
	}
	return result, nil
}
