package deployment

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

var gaugeIdentityFields = []events.Input{
	{Name: "marketId", Type: "bytes32"}, {Name: "assetUid", Type: "bytes32"}, {Name: "quoteAssetConfigId", Type: "bytes32"},
	{Name: "allocationManager", Type: "address"}, {Name: "protocolFeeVault", Type: "address"}, {Name: "quoteAsset", Type: "address"}, {Name: "memeToken", Type: "address"},
}
var gaugePositionFields = []events.Input{
	{Name: "activeAmount", Type: "uint256"}, {Name: "pendingAmount", Type: "uint256"}, {Name: "pendingGeneration", Type: "uint64"},
	{Name: "unlockAt", Type: "uint64"}, {Name: "quoteClaimable", Type: "uint256"}, {Name: "memeClaimable", Type: "uint256"},
}

// observeGauge is called only after the current MarketView was authenticated.
// Stored principal, effective market totals and preview rewards remain separate;
// these reads are inputs to reconciliation, not an assertion of solvency.
func observeGauge(ctx context.Context, rpc BindingObserver, manifest Manifest, block chainrpc.Header, discovered MarketDiscovery, market map[string]any, users map[string]bool) ([]StateObservation, error) {
	timestamp, err := block.Time()
	if err != nil {
		return nil, errors.New("invalid Gauge observation timestamp")
	}
	address, ok := market["gauge"].(string)
	if !ok || address == zero20 || market["stakingEnabled"] != true {
		return nil, errors.New("missing enabled Gauge")
	}
	bound := false
	for _, c := range discovered.Contracts {
		if c.Address == address && c.Module == "MemeStockGauge" {
			code, err := rpc.CodeAt(ctx, address, block.Hash)
			if err != nil || len(code) == 0 || Hash(code) != c.RuntimeCodeHash {
				return nil, errors.New("Gauge runtime identity changed")
			}
			bound = true
		}
	}
	if !bound {
		return nil, errors.New("Gauge lacks discovered runtime identity")
	}
	read := func(signature, args string, fields []events.Input) (map[string]any, error) {
		raw, err := rpc.CallAt(ctx, address, Hash([]byte(signature))[:10]+args, block.Hash)
		if err != nil {
			return nil, fmt.Errorf("Gauge observation failed: %s", signature)
		}
		return events.DecodeStatic(fields, raw)
	}
	identity, err := read("gaugeIdentity()", "", gaugeIdentityFields)
	if err != nil {
		return nil, err
	}
	userClaims, err := feeVaultUsesUserClaims(ctx, rpc, identity["protocolFeeVault"].(string), block)
	if err != nil || !userClaims {
		return nil, errors.New("current user claim mode required")
	}
	expected := map[string]any{"marketId": discovered.MarketID, "assetUid": market["assetUid"], "quoteAssetConfigId": market["quoteAssetConfigId"], "quoteAsset": market["quoteAsset"], "memeToken": market["memeToken"]}
	for _, c := range manifest.Contracts {
		if c.Module == "AllocationManager" {
			expected["allocationManager"] = c.Address
		}
		if c.Module == "ProtocolFeeVault" {
			expected["protocolFeeVault"] = c.Address
		}
	}
	for _, field := range gaugeIdentityFields {
		if expected[field.Name] == nil || identity[field.Name] != expected[field.Name] {
			return nil, fmt.Errorf("Gauge binding mismatch: %s", field.Name)
		}
	}
	state := map[string]any{"identity": identity, "gauge": address}
	for _, name := range []string{"storedTotalActiveStock", "effectiveTotalActiveStock", "totalPendingStock"} {
		value, e := read(name+"()", "", []events.Input{{Name: name, Type: "uint256"}})
		if e != nil {
			return nil, e
		}
		state[name] = value[name]
	}
	deferred, err := read("deferredForfeiture()", "", []events.Input{{Name: "quoteAmount", Type: "uint256"}, {Name: "memeAmount", Type: "uint256"}})
	if err != nil {
		return nil, err
	}
	state["deferredForfeiture"] = deferred
	for _, asset := range []struct{ name, key string }{{"quoteRewardState", "quoteAsset"}, {"memeRewardState", "memeToken"}} {
		value, e := read("rewardState(address)", strings.Repeat("0", 24)+market[asset.key].(string)[2:], []events.Input{{Name: "accFeePerShare", Type: "uint256"}, {Name: "indexRemainder", Type: "uint256"}})
		if e != nil {
			return nil, e
		}
		state[asset.name] = value
	}
	result := []StateObservation{{Kind: "gauge", Key: discovered.MarketID, Value: state}}
	keys := []string{}
	for user := range users {
		keys = append(keys, user)
	}
	sort.Strings(keys)
	knownActive, knownPending := new(big.Int), new(big.Int)
	integer := func(v any) *big.Int { n, _ := new(big.Int).SetString(v.(string), 10); return n }
	snapshots := map[string]map[string]any{}
	for _, user := range keys {
		if !hex20.MatchString(user) || user == zero20 {
			return nil, errors.New("invalid Gauge observation user")
		}
		position, e := read("positionOf(address)", strings.Repeat("0", 24)+user[2:], gaugePositionFields)
		if e != nil {
			return nil, e
		}
		settlement, e := businessReader(ctx, rpc, block)(identity["allocationManager"].(string), "rageQuitSettlementPending(bytes32,address)", discovered.MarketID[2:]+addressArgument(user), []events.Input{{Name: "pending", Type: "bool"}, {Name: "principal", Type: "uint256"}})
		if e != nil {
			return nil, e
		}
		position["rageQuitSettlementPending"] = settlement["pending"]
		position["rageQuitSettlementPrincipal"] = settlement["principal"]
		position["observedAtTimestamp"] = strconv.FormatUint(timestamp, 10)
		knownActive.Add(knownActive, integer(position["activeAmount"]))
		position["marketId"] = discovered.MarketID
		position["user"] = user
		position["gauge"] = address
		if position["pendingAmount"] != "0" {
			generation := position["pendingGeneration"].(string)
			snapshot, exists := snapshots[generation]
			if !exists {
				number, e := strconv.ParseUint(generation, 10, 64)
				if e != nil {
					return nil, e
				}
				word := fmt.Sprintf("%064x", number)
				snapshot, e = read("activationSnapshot(uint64)", word, []events.Input{{Name: "quoteAccumulator", Type: "uint256"}, {Name: "memeAccumulator", Type: "uint256"}, {Name: "refs", Type: "uint256"}, {Name: "processed", Type: "bool"}})
				if e != nil {
					return nil, e
				}
				snapshots[generation] = snapshot
			}
			// Processing moves the batch into global stored active before each
			// user materializes it; positionOf still exposes that pending amount.
			if snapshot["processed"] == true {
				knownActive.Add(knownActive, integer(position["pendingAmount"]))
			} else {
				knownPending.Add(knownPending, integer(position["pendingAmount"]))
			}
			position["activationSnapshot"] = snapshot
		}
		result = append(result, StateObservation{Kind: "gaugePosition", Key: user + ":" + discovered.MarketID, Value: position})
	}
	state["knownStoredActiveSum"] = knownActive.String()
	state["knownPendingSum"] = knownPending.String()
	state["knownUserCount"] = len(users)
	state["checks"] = map[string]bool{"knownActiveSumEqualsStoredTotal": knownActive.Cmp(integer(state["storedTotalActiveStock"])) == 0, "knownPendingSumEqualsTotal": knownPending.Cmp(integer(state["totalPendingStock"])) == 0}
	state["fullReconciliation"] = false
	return result, nil
}
