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

type AssetDiscovery struct {
	ChainID     uint64         `json:"chainId"`
	BlockHash   string         `json:"blockHash"`
	AssetUID    string         `json:"assetUid"`
	State       map[string]any `json:"state"`
	Fingerprint map[string]any `json:"fingerprint"`
	Vault       Contract       `json:"vault"`
}

var assetFields = []events.Input{{Name: "stockToken", Type: "address"}, {Name: "userStockVault", Type: "address"}, {Name: "tokenDecimals", Type: "uint8"}, {Name: "status", Type: "uint8"}}
var vaultIdentityFields = []events.Input{{Name: "officialStockRegistry", Type: "address"}, {Name: "marketRegistry", Type: "address"}, {Name: "allocationManager", Type: "address"}, {Name: "schemaId", Type: "bytes32"}}
var fingerprintFields = []events.Input{{Name: "tokenRuntimeCodeHash", Type: "bytes32"}, {Name: "beacon", Type: "address"}, {Name: "beaconRuntimeCodeHash", Type: "bytes32"}, {Name: "implementation", Type: "address"}, {Name: "implementationRuntimeCodeHash", Type: "bytes32"}}
var vaultSchema = Hash([]byte("TickerGarden.UserStockVault.MultiAsset.v6"))

type viewReader func(string, string, string, []events.Input) (map[string]any, error)

func businessReader(ctx context.Context, rpc BindingObserver, block chainrpc.Header) viewReader {
	return func(address, signature, args string, fields []events.Input) (map[string]any, error) {
		raw, err := rpc.CallAt(ctx, address, Hash([]byte(signature))[:10]+args, block.Hash)
		if err != nil {
			return nil, fmt.Errorf("Vault/asset observation failed: %s", signature)
		}
		return events.DecodeStatic(fields, raw)
	}
}
func sortedSet(values map[string]bool) []string {
	out := []string{}
	for key := range values {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}
func addressArgument(address string) string { return strings.Repeat("0", 24) + address[2:] }

// DiscoverAssets resolves authenticated registry event/market IDs, including
// assets without a market. The Registry's historical identity predicate covers
// its supported token/beacon implementation model; no template hash is substituted
// for a deployed runtime hash. It never discovers from untrusted lookalike logs.
func DiscoverAssets(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, ids map[string]bool) (map[string]AssetDiscovery, error) {
	if _, err := VerifyCoreBindings(ctx, rpc, m, block); err != nil {
		return nil, err
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		roots[c.Module] = c.Address
	}
	registry := roots["OfficialStockRegistryV1"]
	read := businessReader(ctx, rpc, block)
	result := map[string]AssetDiscovery{}
	tokens := map[string]string{}
	for _, id := range sortedSet(ids) {
		if !hex32.MatchString(id) || id == zero32 {
			return nil, errors.New("invalid discovered asset UID")
		}
		state, err := read(registry, "asset(bytes32)", id[2:], assetFields)
		if err != nil {
			return nil, err
		}
		minimum, e := read(registry, "minimumAllocation(bytes32)", id[2:], []events.Input{{Name: "minimumAllocation", Type: "uint256"}})
		if e != nil {
			return nil, e
		}
		amount, ok := new(big.Int).SetString(minimum["minimumAllocation"].(string), 10)
		if !ok || amount.Cmp(big.NewInt(414)) < 0 {
			return nil, errors.New("asset minimum allocation below canonical floor")
		}
		state["minimumAllocation"] = minimum["minimumAllocation"]
		token, vault := state["stockToken"].(string), state["userStockVault"].(string)
		decimals, _ := strconv.ParseUint(state["tokenDecimals"].(string), 10, 8)
		if token == zero20 || vault == zero20 || token == vault || decimals < 6 || decimals > 18 || (state["status"] != "1" && state["status"] != "2" && state["status"] != "3") {
			return nil, errors.New("invalid canonical asset")
		}
		if old, ok := tokens[token]; ok && old != id {
			return nil, errors.New("duplicate canonical stock token")
		}
		tokens[token] = id
		for _, predicate := range []struct{ signature, arg string }{{"assetIdentityCurrent(bytes32)", id[2:]}, {"vaultIdentityCurrent(address)", addressArgument(vault)}} {
			value, e := read(registry, predicate.signature, predicate.arg, []events.Input{{Name: "current", Type: "bool"}})
			if e != nil {
				return nil, e
			}
			if value["current"] != true {
				return nil, errors.New("canonical asset or Vault identity drift")
			}
		}
		identity, err := read(vault, "vaultIdentity()", "", vaultIdentityFields)
		if err != nil {
			return nil, err
		}
		expected := map[string]string{"officialStockRegistry": registry, "marketRegistry": roots["MarketRegistryV1"], "allocationManager": roots["AllocationManager"], "schemaId": vaultSchema}
		for _, field := range vaultIdentityFields {
			if identity[field.Name] != expected[field.Name] {
				return nil, fmt.Errorf("Vault binding mismatch: %s", field.Name)
			}
		}
		for _, check := range []struct{ signature, arg, name, typ, want string }{
			{"vaultSchemaId(address)", addressArgument(vault), "schema", "bytes32", vaultSchema},
			{"vaultForSchema(bytes32)", vaultSchema[2:], "vault", "address", vault},
		} {
			value, e := read(registry, check.signature, check.arg, []events.Input{{Name: check.name, Type: check.typ}})
			if e != nil {
				return nil, e
			}
			if value[check.name] != check.want {
				return nil, errors.New("Vault schema binding mismatch")
			}
		}
		hash, err := read(registry, "vaultRuntimeCodeHash(address)", addressArgument(vault), []events.Input{{Name: "hash", Type: "bytes32"}})
		if err != nil {
			return nil, err
		}
		code, err := rpc.CodeAt(ctx, vault, block.Hash)
		if err != nil || len(code) == 0 || Hash(code) != hash["hash"] {
			return nil, errors.New("Vault runtime identity mismatch")
		}
		fingerprint, err := read(registry, "assetFingerprint(bytes32)", id[2:], fingerprintFields)
		if err != nil {
			return nil, err
		}
		code, err = rpc.CodeAt(ctx, token, block.Hash)
		if err != nil || len(code) == 0 || Hash(code) != fingerprint["tokenRuntimeCodeHash"] {
			return nil, errors.New("stock token runtime identity mismatch")
		}
		result[id] = AssetDiscovery{ChainID: m.ChainID, BlockHash: block.Hash, AssetUID: id, State: state, Fingerprint: fingerprint, Vault: Contract{Module: "UserStockVault", Address: vault, RuntimeCodeHash: hash["hash"].(string)}}
	}
	end, err := rpc.Header(ctx, block.Number)
	if err != nil {
		return nil, err
	}
	if end.Hash != block.Hash {
		return nil, errors.New("asset discovery block changed")

	}
	return result, nil
}

// observeVault records checks as evidence even when they fail. An underfunded
// asset must remain observable; a future publisher must reject failed checks.
// This does not prove all-user or all-market sums without complete enumeration.
func observeVault(ctx context.Context, rpc BindingObserver, block chainrpc.Header, asset AssetDiscovery, users map[string]bool, marketUsers map[string]map[string]bool) ([]StateObservation, error) {
	if asset.BlockHash != block.Hash {
		return nil, errors.New("Vault asset observation block mismatch")
	}
	read := businessReader(ctx, rpc, block)
	id := asset.AssetUID
	vault := asset.Vault.Address
	token := asset.State["stockToken"].(string)
	readAmount := func(address, signature, args string) (string, error) {
		value, err := read(address, signature, args, []events.Input{{Name: "amount", Type: "uint256"}})
		if err != nil {
			return "", err
		}
		return value["amount"].(string), nil
	}
	deposited, err := readAmount(vault, "totalDeposited(bytes32)", id[2:])
	if err != nil {
		return nil, err
	}
	allocated, err := readAmount(vault, "totalAllocated(bytes32)", id[2:])
	if err != nil {
		return nil, err
	}
	balance, err := readAmount(token, "balanceOf(address)", addressArgument(vault))
	if err != nil {
		return nil, err
	}
	number := func(s string) *big.Int { value, _ := new(big.Int).SetString(s, 10); return value }
	checks := map[string]bool{"balanceCoversDeposits": number(balance).Cmp(number(deposited)) >= 0, "allocatedWithinDeposits": number(allocated).Cmp(number(deposited)) <= 0}
	result := []StateObservation{{Kind: "asset", Key: id, Value: map[string]any{"asset": asset.State, "fingerprint": asset.Fingerprint, "vaultRuntimeCodeHash": asset.Vault.RuntimeCodeHash}},
		{Kind: "vaultSolvency", Key: id, Value: map[string]any{"assetUid": id, "vault": vault, "stockToken": token, "totalDeposited": deposited, "totalAllocated": allocated, "tokenBalance": balance, "checks": checks, "fullReconciliation": false}}}
	userDeposits, userAllocated, marketSum := new(big.Int), new(big.Int), new(big.Int)
	for _, user := range sortedSet(users) {
		if !hex20.MatchString(user) || user == zero20 {
			return nil, errors.New("invalid Vault observation user")
		}
		state := map[string]any{"assetUid": id, "user": user, "vault": vault}
		for _, name := range []string{"deposited", "allocated", "freeBalanceOf"} {
			amount, e := readAmount(vault, name+"(bytes32,address)", id[2:]+addressArgument(user))
			if e != nil {
				return nil, e
			}
			state[name] = amount
		}
		dep, alloc, free := number(state["deposited"].(string)), number(state["allocated"].(string)), number(state["freeBalanceOf"].(string))
		userDeposits.Add(userDeposits, dep)
		userAllocated.Add(userAllocated, alloc)
		state["checks"] = map[string]bool{"allocatedWithinDeposited": alloc.Cmp(dep) <= 0, "freeEqualsDepositedMinusAllocated": new(big.Int).Sub(dep, alloc).Cmp(free) == 0, "userWithinAssetDeposits": dep.Cmp(number(deposited)) <= 0, "userWithinAssetAllocations": alloc.Cmp(number(allocated)) <= 0}
		result = append(result, StateObservation{Kind: "vaultPosition", Key: id + ":" + user, Value: state})
	}
	marketIDs := map[string]bool{}
	for marketID := range marketUsers {
		marketIDs[marketID] = true
	}
	for _, marketID := range sortedSet(marketIDs) {
		state := map[string]any{"assetUid": id, "marketId": marketID, "vault": vault}
		for _, name := range []string{"marketAllocated", "marketRewardEligible", "marketRewardCohortEpoch"} {
			amount, e := readAmount(vault, name+"(bytes32,bytes32)", id[2:]+marketID[2:])
			if e != nil {
				return nil, e
			}
			state[name] = amount
		}
		marketAllocated := number(state["marketAllocated"].(string))
		marketSum.Add(marketSum, marketAllocated)
		allocationSum := new(big.Int)
		state["checks"] = map[string]bool{"marketWithinAssetAllocated": marketAllocated.Cmp(number(allocated)) <= 0, "eligibleWithinMarketAllocated": number(state["marketRewardEligible"].(string)).Cmp(marketAllocated) <= 0}
		result = append(result, StateObservation{Kind: "vaultMarket", Key: id + ":" + marketID, Value: state})
		for _, user := range sortedSet(marketUsers[marketID]) {
			args := id[2:] + addressArgument(user) + marketID[2:]
			amount, e := readAmount(vault, "allocation(bytes32,address,bytes32)", args)
			if e != nil {
				return nil, e
			}
			allocationSum.Add(allocationSum, number(amount))
			cutoff, e := read(vault, "rageQuitRewardCutoff(bytes32,address,bytes32)", args, []events.Input{{Name: "principal", Type: "uint256"}, {Name: "quoteAccumulator", Type: "uint256"}, {Name: "memeAccumulator", Type: "uint256"}, {Name: "forfeitureRedistributable", Type: "bool"}})
			if e != nil {
				return nil, e
			}
			result = append(result, StateObservation{Kind: "vaultAllocation", Key: id + ":" + user + ":" + marketID, Value: map[string]any{"assetUid": id, "user": user, "marketId": marketID, "vault": vault, "allocation": amount, "rageQuitRewardCutoff": cutoff, "checks": map[string]bool{"userWithinMarketAllocated": number(amount).Cmp(marketAllocated) <= 0}}})
		}
		state["knownUserAllocationSum"] = allocationSum.String()
		state["knownUserCount"] = len(marketUsers[marketID])
		state["checks"].(map[string]bool)["knownUserSumEqualsMarketAllocated"] = allocationSum.Cmp(marketAllocated) == 0
	}
	result[1].Value["knownUserDepositedSum"] = userDeposits.String()
	result[1].Value["knownUserAllocatedSum"] = userAllocated.String()
	result[1].Value["knownMarketAllocatedSum"] = marketSum.String()
	result[1].Value["knownUserCount"] = len(users)
	result[1].Value["knownMarketCount"] = len(marketUsers)
	checks["knownUserSumEqualsDeposited"] = userDeposits.Cmp(number(deposited)) == 0
	checks["knownUserSumEqualsAllocated"] = userAllocated.Cmp(number(allocated)) == 0
	checks["knownMarketSumEqualsAllocated"] = marketSum.Cmp(number(allocated)) == 0
	return result, nil
}

const VaultObservationScope = "market-curve-gauge-vault-v1"

type VaultAccount struct{ AssetUID, User, MarketID string }

const MaxVaultAccounts = 10000

// ObserveAssetBlock refreshes event users and the supplied canonical history.
// Known-account sums are evidence; full history completeness remains separate.
func ObserveAssetBlock(ctx context.Context, rpc BindingObserver, block chainrpc.Header, chain uint64, v Verified, assets map[string]AssetDiscovery, markets map[string]MarketDiscovery, logs []chainrpc.Log, history ...VaultAccount) (ObservationBatch, error) {
	if v.chain != chain || v.hash != block.Hash {
		return ObservationBatch{}, errors.New("Vault observation outside verified block")
	}
	for _, asset := range assets {
		if asset.ChainID != chain || asset.BlockHash != block.Hash {
			return ObservationBatch{}, errors.New("Vault asset outside discovery block")
		}
	}
	users := map[string]map[string]bool{}
	marketUsers := map[string]map[string]map[string]bool{}
	for marketID, market := range markets {
		if market.State["stakingEnabled"] != true {
			continue
		}
		id := market.State["assetUid"].(string)
		if marketUsers[id] == nil {
			marketUsers[id] = map[string]map[string]bool{}
		}
		marketUsers[id][marketID] = map[string]bool{}
	}

	if len(history) > MaxVaultAccounts {
		return ObservationBatch{}, errors.New("Vault account budget exceeded")
	}
	for _, account := range history {
		if !hex32.MatchString(account.AssetUID) || !hex20.MatchString(account.User) || account.User == zero20 {
			return ObservationBatch{}, errors.New("invalid historical Vault account")
		}
		if _, ok := assets[account.AssetUID]; !ok {
			return ObservationBatch{}, errors.New("historical Vault account lacks asset")
		}
		if users[account.AssetUID] == nil {
			users[account.AssetUID] = map[string]bool{}
		}
		users[account.AssetUID][account.User] = true
		if account.MarketID != "" {
			if marketUsers[account.AssetUID] == nil || marketUsers[account.AssetUID][account.MarketID] == nil {
				return ObservationBatch{}, errors.New("historical Vault allocation lacks market")
			}
			marketUsers[account.AssetUID][account.MarketID][account.User] = true
		}
	}
	for _, log := range logs {
		if log.BlockNumber != block.Number {
			return ObservationBatch{}, errors.New("Vault observation source block mismatch")
		}
		event, err := v.Decode(chain, log)
		if errors.Is(err, events.ErrUnknown) {
			continue
		}
		if err != nil {
			return ObservationBatch{}, err
		}
		id, _ := event.Args["assetUid"].(string)
		if marketID, ok := event.Args["marketId"].(string); ok {
			if market, exists := markets[marketID]; exists && market.State["stakingEnabled"] == true {
				marketAsset := market.State["assetUid"].(string)
				if id != "" && id != marketAsset {
					return ObservationBatch{}, errors.New("Vault event market asset mismatch")
				}
				id = marketAsset
			}
		}
		if id == "" || id == zero32 {
			continue
		}
		asset, ok := assets[id]
		if !ok {
			return ObservationBatch{}, errors.New("Vault event lacks registered asset")
		}
		if event.Module == "UserStockVault" && event.Emitter != asset.Vault.Address {
			return ObservationBatch{}, errors.New("Vault event asset binding mismatch")
		}
		if user, ok := event.Args["user"].(string); ok && user != zero20 {
			if users[id] == nil {
				users[id] = map[string]bool{}
			}
			users[id][user] = true
			if marketID, ok := event.Args["marketId"].(string); ok && marketUsers[id] != nil && marketUsers[id][marketID] != nil {
				marketUsers[id][marketID][user] = true
			}
		}
	}
	ids := map[string]bool{}
	for id := range assets {
		ids[id] = true
	}
	batch := ObservationBatch{Scope: VaultObservationScope, ChainID: chain, BlockNumber: block.Number, BlockHash: block.Hash, Observations: []StateObservation{}}
	for id := range assets {
		batch.Expected += 2 + len(users[id]) + len(marketUsers[id])
		for _, accounts := range marketUsers[id] {
			batch.Expected += len(accounts)
		}
	}
	for _, id := range sortedSet(ids) {
		rows, err := observeVault(ctx, rpc, block, assets[id], users[id], marketUsers[id])
		if err != nil {
			return ObservationBatch{}, err
		}
		batch.Observations = append(batch.Observations, rows...)
	}
	end, err := rpc.Header(ctx, block.Number)
	if err != nil {
		return ObservationBatch{}, err
	}
	if end.Hash != block.Hash {
		return ObservationBatch{}, errors.New("Vault observation block changed")
	}
	return batch, nil
}
