package readmodel

import (
	"encoding/json"
	"errors"
	"math/big"
	"reflect"
	"strconv"
	"strings"
	"tickergarden/backend/internal/deployment"
)

// BuildPositionCandidate joins one market's same-block Vault and Gauge views.
// It does not prove complete account enumeration or authorize publication. The
// caller authenticates batch and source receipts; unresolved exit settlement or
// disagreeing principal views must not be converted into a normal position.
func BuildPositionCandidate(batch deployment.ObservationBatch, marketID, user string, marketSource, positionSource SourceBlock) (UserPositionReadModel, error) {
	fail := func() (UserPositionReadModel, error) {
		return UserPositionReadModel{}, errors.New("incomplete or inconsistent position candidate")
	}
	market, e := BuildMarketCandidate(batch, marketID, marketSource)
	if e != nil {
		return fail()
	}
	if !candidateAddress.MatchString(user) || user == "0x"+strings.Repeat("0", 40) {
		return fail()
	}
	rows := map[string]map[string]any{}
	for _, o := range batch.Observations {
		rows[o.Kind+":"+o.Key] = o.Value
	}
	asset := rows["asset:"+market.AssetUID]
	state, ok := asset["asset"].(map[string]any)
	if !ok {
		return fail()
	}
	vault, ok := state["userStockVault"].(string)
	if !ok || !candidateAddress.MatchString(vault) || vault == "0x"+strings.Repeat("0", 40) {
		return fail()
	}
	principal := rows["vaultPosition:"+market.AssetUID+":"+user]
	allocation := rows["vaultAllocation:"+market.AssetUID+":"+user+":"+marketID]
	gauge := rows["gaugePosition:"+user+":"+marketID]
	if principal == nil || allocation == nil || gauge == nil {
		return fail()
	}
	for _, v := range []map[string]any{principal, allocation} {
		if !reflect.DeepEqual(v["user"], user) || !reflect.DeepEqual(v["assetUid"], market.AssetUID) || !reflect.DeepEqual(v["vault"], vault) {
			return fail()
		}
	}
	if !reflect.DeepEqual(allocation["marketId"], marketID) || !reflect.DeepEqual(gauge["marketId"], marketID) || !reflect.DeepEqual(gauge["user"], user) || !reflect.DeepEqual(gauge["gauge"], market.Gauge) {
		return fail()
	}
	pendingExit, ok := gauge["rageQuitSettlementPending"].(bool)
	if !ok || pendingExit {
		return fail()
	}
	amount := func(v any) (*big.Int, bool) {
		s, ok := v.(string)
		if !ok {
			return nil, false
		}
		n, e := raw(s)
		return n, e == nil && n.String() == s
	}
	values := []any{principal["deposited"], principal["allocated"], principal["freeBalanceOf"], allocation["allocation"], gauge["activeAmount"], gauge["pendingAmount"], gauge["quoteClaimable"], gauge["memeClaimable"], gauge["rageQuitSettlementPrincipal"]}
	amounts := make([]*big.Int, len(values))
	for i, v := range values {
		n, ok := amount(v)
		if !ok {
			return fail()
		}
		amounts[i] = n
	}
	if amounts[8].Sign() != 0 || amounts[0].Cmp(new(big.Int).Add(amounts[1], amounts[2])) != 0 || amounts[3].Cmp(amounts[1]) > 0 || amounts[3].Cmp(new(big.Int).Add(amounts[4], amounts[5])) != 0 {
		return fail()
	}
	normalized, e := NormalizeGaugePrincipal(amounts[4].String(), amounts[5].String(), gauge["pendingGeneration"], gauge["unlockAt"], gauge["activationSnapshot"])
	if e != nil {
		return fail()
	}
	result := UserPositionReadModel{User: user, AssetUID: market.AssetUID, MarketID: marketID, Free: amounts[2].String(), Allocated: amounts[3].String(), Pending: normalized.Pending, Active: normalized.Active, ActivationAt: normalized.ActivationAt, UnlockAt: normalized.UnlockAt, Claimable: []Claimable{{Kind: "quote", Asset: market.QuoteAsset, Amount: amounts[6].String()}, {Kind: "meme", Asset: market.MemeToken, Amount: amounts[7].String()}}, Source: positionSource}
	n, _ := strconv.ParseUint(batch.BlockNumber, 0, 64)
	sn, se := Height(positionSource.BlockNumber)
	if se != nil || sn > n || (sn == n && positionSource.BlockHash != batch.BlockHash) || positionSource.ChainID != batch.ChainID {
		return fail()
	}
	encoded, e := json.Marshal(result)
	if e != nil || ValidateResponse("UserPositionReadModel", encoded) != nil {
		return fail()
	}
	return result, nil
}
