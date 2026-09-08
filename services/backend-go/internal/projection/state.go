// Package projection applies authenticated, ordered V1 events to replayable
// business facts. It does not authenticate emitters or reconcile balances itself.
package projection

import (
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

type Row map[string]any
type Observation struct {
	Kind  string `json:"kind"`
	Key   string `json:"key"`
	Value Row    `json:"value"`
}
type Input struct {
	ChainID      uint64        `json:"chainId"`
	Module       string        `json:"module"`
	Log          chainrpc.Log  `json:"log"`
	Observations []Observation `json:"observations,omitempty"`
}
type State struct {
	tables       map[string]map[string]Row
	last         Row
	fingerprints map[string]string
	changes      map[string]map[string]Row
}

var tableNames = []string{"events", "configs", "markets", "pools", "poolEvents", "curveTrades", "stockPositions", "allocations", "activationBuckets", "gaugePositions", "rewardExits", "feeCredits", "feeClaims", "feeClaimTotals", "swaps", "observations"}
var hashPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)

func New() *State {
	s := &State{tables: map[string]map[string]Row{}, fingerprints: map[string]string{}}
	for _, name := range tableNames {
		s.tables[name] = map[string]Row{}
	}
	return s
}
func (s *State) Snapshot() ([]byte, error) {
	out := Row{"tables": s.tables}
	if s.last != nil {
		out["lastPosition"] = s.last
	}
	return json.Marshal(out)
}
func key(parts ...string) string { return strings.ToLower(strings.Join(parts, ":")) }
func str(v any) string           { s, _ := v.(string); return s }
func copyRow(r Row) Row {
	out := Row{}
	for k, v := range r {
		out[k] = v
	}
	return out
}
func combine(a, b Row) Row {
	out := copyRow(a)
	for k, v := range b {
		out[k] = v
	}
	return out
}
func values(row Row) Row { v, _ := row["values"].(Row); return v }

type stage struct {
	s       *State
	changes map[string]map[string]Row
	at      Row
}

func (x *stage) get(table, k string) Row {
	if row, ok := x.changes[table][k]; ok {
		return row
	}
	return x.s.tables[table][k]
}
func (x *stage) set(table, k string, row Row) {
	if x.changes[table] == nil {
		x.changes[table] = map[string]Row{}
	}
	x.changes[table][k] = row
}
func (x *stage) put(table, k string, v Row) {
	x.set(table, k, Row{"key": k, "values": copyRow(v), "provenance": x.at})
}
func (x *stage) merge(table, k string, v Row) { x.put(table, k, combine(values(x.get(table, k)), v)) }
func (x *stage) market(id string, v Row) {
	k := key(id)
	x.set("markets", k, Row{"marketId": k, "values": combine(values(x.get("markets", k)), v), "provenance": x.at})
}
func (x *stage) config(kind, id, status string, v Row, replace bool) {
	k := key(kind, id)
	if !replace {
		v = combine(values(x.get("configs", k)), v)
	}
	x.set("configs", k, Row{"kind": kind, "id": key(id), "status": status, "values": copyRow(v), "provenance": x.at})
}
func (x *stage) allocationForGauge(user, market string, patch Row) {
	v := values(x.get("gaugePositions", key(user, market)))
	if asset := str(v["assetUid"]); asset != "" {
		x.merge("allocations", key(asset, user, market), patch)
	}
}
func (x *stage) curveMarket(emitter string) (string, error) {
	for id, row := range x.s.tables["markets"] {
		if strings.EqualFold(str(values(row)["curve"]), emitter) {
			return id, nil
		}
	}
	return "", errors.New("unknown Curve emitter")
}
func (x *stage) feeIdentity(id, market, asset string) error {
	old := values(x.get("feeCredits", key(id)))
	for _, entry := range [][2]string{{"marketId", market}, {"feeAsset", asset}, {"quoteAsset", asset}} {
		if v := str(old[entry[0]]); v != "" && !strings.EqualFold(v, entry[1]) {
			return errors.New("conflicting canonical fee identity")
		}
	}
	return nil
}

// Apply is atomic even if late observation validation fails. Only changed rows
// are staged; existing event history is never copied on each append. Callers must
// serialize access and establish emitter authority using deployment/discovery.
func (s *State) Apply(input Input) (string, error) {
	if s == nil || s.tables == nil {
		return "", errors.New("uninitialized projection")
	}
	if input.ChainID != 4663 && input.ChainID != 46630 && input.ChainID != 421614 {
		return "", errors.New("unsupported projection chain")
	}
	s.changes = nil
	log := input.Log
	n, err := chainrpc.Quantity(log.BlockNumber)
	if err != nil {
		return "", err
	}
	ti, err := chainrpc.Quantity(log.TransactionIndex)
	if err != nil || ti > 1<<53-1 {
		return "", errors.New("invalid projection transaction index")
	}
	li, err := chainrpc.Quantity(log.LogIndex)
	if err != nil || li > 1<<53-1 {
		return "", errors.New("invalid projection log index")
	}
	if !hashPattern.MatchString(log.BlockHash) || !hashPattern.MatchString(log.TransactionHash) {
		return "", errors.New("invalid projection block/transaction hash")
	}
	decoded, err := events.Decode(input.Module, log)
	if err != nil {
		return "", err
	}
	args := Row(decoded.Args)
	eventKey := key(strconv.FormatUint(input.ChainID, 10), log.TransactionHash, strconv.FormatUint(li, 10))
	at := Row{"chainId": input.ChainID, "blockNumber": strconv.FormatUint(n, 10), "blockHash": strings.ToLower(log.BlockHash), "transactionHash": strings.ToLower(log.TransactionHash), "transactionIndex": ti, "logIndex": li, "emitter": decoded.Emitter, "eventKey": eventKey}
	// Normalize observations into privately owned JSON values before staging.
	observations := []Observation{}
	if len(input.Observations) > 0 {
		data, err := json.Marshal(input.Observations)
		if err != nil {
			return "", errors.New("invalid observation JSON")
		}
		d := json.NewDecoder(strings.NewReader(string(data)))
		d.UseNumber()
		if err = d.Decode(&observations); err != nil {
			return "", err
		}
	}
	fp, _ := json.Marshal(Row{"module": input.Module, "provenance": at, "signature": decoded.Signature, "args": args, "observations": observations})
	if prior, exists := s.fingerprints[eventKey]; exists {
		if prior != string(fp) {
			return "", errors.New("conflicting duplicate projection event")
		}
		return "duplicate", nil
	}
	if s.last != nil {
		lastN, _ := strconv.ParseUint(str(s.last["blockNumber"]), 10, 64)
		if s.last["chainId"] != input.ChainID || n < lastN || (n == lastN && (s.last["blockHash"] != at["blockHash"] || ti < s.last["transactionIndex"].(uint64) || li <= s.last["logIndex"].(uint64))) {
			return "", errors.New("out-of-order or conflicting projection block")
		}
	}
	x := &stage{s: s, changes: map[string]map[string]Row{}, at: at}
	name := strings.SplitN(decoded.Signature, "(", 2)[0]
	if err = x.apply(name, decoded.Signature, args); err != nil {
		return "", err
	}
	for _, o := range observations {
		allowed := map[string]bool{"asset": true, "assetIdentity": true, "quote": true, "baseline": true, "template": true, "market": true, "poolKey": true, "curve": true, "vaultPosition": true, "vaultSolvency": true, "gaugePosition": true, "liability": true}
		if !allowed[o.Kind] || o.Key == "" || o.Value == nil {
			return "", errors.New("invalid chain observation scope")
		}
		x.put("observations", key(o.Kind, o.Key), o.Value)
		switch o.Kind {
		case "market":
			x.market(o.Key, o.Value)
		case "poolKey":
			x.put("pools", key(o.Key), o.Value)
		case "vaultPosition":
			x.put("stockPositions", key(o.Key), o.Value)
		case "gaugePosition":
			x.put("gaugePositions", key(o.Key), o.Value)
		case "asset", "assetIdentity", "quote", "baseline", "template":
			kind := o.Kind
			if kind == "assetIdentity" {
				kind = "asset"
			}
			k := key(kind, o.Key)
			old := x.get("configs", k)
			if old == nil {
				return "", errors.New("cannot hydrate unknown configuration")
			}
			x.config(kind, o.Key, str(old["status"]), o.Value, false)
		}
	}
	x.set("events", eventKey, Row{"provenance": at, "signature": decoded.Signature, "args": copyRow(args)})
	for table, rows := range x.changes {
		for k, row := range rows {
			s.tables[table][k] = row
		}
	}
	s.changes = x.changes
	s.last = at
	s.fingerprints[eventKey] = string(fp)
	return "applied", nil
}

// Replay rebuilds a fresh state from the selected canonical event sequence.
// Branch selection and durable checkpoint transactions belong to the worker.
func Replay(inputs []Input) (*State, error) {
	s := New()
	for _, input := range inputs {
		if _, err := s.Apply(input); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (x *stage) apply(name, signature string, a Row) error {
	get := func(k string) string { return str(a[k]) }
	market, user := get("marketId"), get("user")
	gaugeKey := key(user, market)
	last := combine(a, Row{"lastEvent": signature})
	switch name {
	case "AllocationRageQuitExecuted", "RageQuitRewardSettlementFinalized", "GaugeRageQuit":
		if a["redistributed"] == true {
			return errors.New("redistribution violates platform forfeiture policy")
		}
	case "StakerFeeCredited", "FeeBucketsCredited", "CurveFeesSwept", "V4FeeAccrued":
		asset := get("feeAsset")
		if name == "CurveFeesSwept" {
			asset = get("quoteAsset")
		}
		if err := x.feeIdentity(get("feeId"), market, asset); err != nil {
			return err
		}
	}
	switch name {
	case "AssetRegistered":
		x.config("asset", get("assetUid"), "1", a, true)
	case "QuoteAssetConfigAdded":
		x.config("quote", get("configId"), "1", a, true)
	case "TickerGardenBaselineAdded":
		x.config("baseline", get("baselineId"), "1", a, true)
	case "LaunchTemplateAdded":
		x.config("template", get("launchTemplateId"), "1", a, true)
	case "AssetStatusChanged", "QuoteAssetStatusChanged", "TickerGardenBaselineStatusChanged", "LaunchTemplateStatusChanged":
		kind, id := "asset", get("assetUid")
		switch name {
		case "QuoteAssetStatusChanged":
			kind, id = "quote", get("configId")
		case "TickerGardenBaselineStatusChanged":
			kind, id = "baseline", get("baselineId")
		case "LaunchTemplateStatusChanged":
			kind, id = "template", get("launchTemplateId")
		}
		x.config(kind, id, get("newStatus"), Row{"reasonHash": a["reasonHash"]}, false)
	case "AssetMinimumAllocationChanged", "StockTokenFingerprintRegistered", "AssetImplementationAccepted":
		id := get("assetUid")
		status := str(x.get("configs", key("asset", id))["status"])
		if status == "" {
			status = "1"
		}
		patch := a
		if name == "AssetMinimumAllocationChanged" {
			patch = Row{"minimumAllocation": a["newMinimum"], "minimumAllocationReasonHash": a["reasonHash"]}
		} else {
			x.merge("observations", key("assetIdentity", id), a)
			if name == "AssetImplementationAccepted" {
				patch = combine(a, Row{"implementation": a["newImplementation"], "implementationRuntimeCodeHash": a["newImplementationRuntimeCodeHash"]})
			}
		}
		x.config("asset", id, status, patch, false)
	case "QuoteAssetIdentityPinned", "StockQuoteConfigBound":
		id := get("configId")
		old := x.get("configs", key("quote", id))
		if old == nil || !strings.EqualFold(str(values(old)["quoteAsset"]), get("quoteAsset")) {
			return errors.New("unknown or mismatched quote identity")
		}
		patch := a
		if name == "QuoteAssetIdentityPinned" {
			patch = Row{"quoteAsset": a["quoteAsset"], "runtimeCodeHash": a["runtimeCodeHash"]}
		}
		x.config("quote", id, str(old["status"]), patch, false)
	case "MarketCreated", "MarketRegistered":
		x.market(market, a)
	case "LaunchPhaseChanged":
		x.market(market, Row{"launchPhase": a["newPhase"], "poolId": a["poolId"], "sourceVersion": a["sourceVersion"]})
	case "CreatorRevenueEpochInitialized":
		x.market(market, Row{"creatorEpoch": a["epoch"], "creatorBeneficiary": a["beneficiary"]})
	case "CreatorRevenueBeneficiaryUpdated":
		x.market(market, Row{"creatorEpoch": a["newEpoch"], "creatorBeneficiary": a["newBeneficiary"]})
	case "CurveBuy", "CurveSell", "CurveBuyRefunded":
		id, err := x.curveMarket(str(x.at["emitter"]))
		if err != nil {
			return err
		}
		x.put("curveTrades", str(x.at["eventKey"]), combine(a, Row{"marketId": id}))
	case "CurveFeeTransferred":
		x.put("curveTrades", str(x.at["eventKey"]), a)
	case "CurveCompleted":
		x.put("curveTrades", str(x.at["eventKey"]), a)
		x.market(market, Row{"curveCompleted": true})
	case "ExpectedPoolRegistered", "PoolBindingActivated", "PoolGraduated":
		x.merge("pools", key(get("poolId")), a)
		x.put("poolEvents", str(x.at["eventKey"]), a)
		x.market(market, Row{"poolId": a["poolId"], "poolEvent": signature})
	case "Donate":
		x.put("poolEvents", str(x.at["eventKey"]), a)
	case "StockDeposited", "StockWithdrawn":
		x.merge("stockPositions", key(get("assetUid"), user), last)
	case "AllocationLocked", "AllocationReleased", "AllocationRageQuit":
		x.merge("allocations", key(get("assetUid"), user, market), last)
	case "AllocationRageQuitExecuted", "GaugeRageQuit":
		x.merge("gaugePositions", gaugeKey, combine(last, Row{"redistributed": false, "forfeitureDestination": "platform_forfeiture_reserve"}))
	case "RageQuitRewardSettlementQueued", "RageQuitRewardSettlementCompleted", "RageQuitRewardSettlementDeferred", "RageQuitRewardSettlementFinalized":
		patch := copyRow(last)
		switch name {
		case "RageQuitRewardSettlementQueued":
			patch = combine(patch, Row{"rageQuitSettlementPending": true, "rageQuitSettlementPrincipal": a["principal"], "rageQuitSettlementStatus": "queued"})
		case "RageQuitRewardSettlementCompleted":
			patch = combine(patch, Row{"rageQuitSettlementPending": false, "rageQuitSettlementPrincipal": "0", "rageQuitSettlementCompletedPrincipal": a["principal"], "rageQuitSettlementStatus": "completed"})
		case "RageQuitRewardSettlementDeferred":
			patch = combine(patch, Row{"rageQuitSettlementPending": true, "rageQuitSettlementPrincipal": a["principal"], "rageQuitSettlementGauge": a["gauge"], "rageQuitSettlementStatus": "deferred"})
		case "RageQuitRewardSettlementFinalized":
			patch = combine(patch, Row{"rageQuitSettlementPending": false, "rageQuitSettlementPrincipal": "0", "rageQuitSettlementCompletedPrincipal": a["principal"], "rageQuitSettlementStatus": "finalized", "rageQuitQuoteForfeited": a["quoteForfeited"], "rageQuitMemeForfeited": a["memeForfeited"], "rageQuitRewardsRedistributed": false, "rageQuitForfeitureDestination": "platform_forfeiture_reserve"})
		}
		x.merge("gaugePositions", gaugeKey, patch)
		if name == "RageQuitRewardSettlementQueued" || name == "RageQuitRewardSettlementCompleted" {
			x.merge("allocations", key(get("assetUid"), user, market), patch)
		} else {
			x.allocationForGauge(user, market, patch)
		}
	case "PendingScheduled", "PendingRescheduled", "PendingMaterialized":
		x.merge("gaugePositions", gaugeKey, last)
	case "RewardConverted":
		if get("creatorEpoch") == "0" {
			x.merge("gaugePositions", gaugeKey, combine(last, Row{"conversionType": "staker"}))
		}
	case "RawRewardExitRequested":
		x.merge("rewardExits", gaugeKey, combine(last, Row{"rawRewardExitRequested": true, "rawRewardExitStatus": "requested"}))
	case "RawRewardExitCancelled":
		x.merge("rewardExits", gaugeKey, combine(last, Row{"availableAt": "0", "rawRewardExitRequested": false, "rawRewardExitStatus": "cancelled"}))
	case "ForfeitureRecordDeferred":
		x.merge("gaugePositions", gaugeKey, combine(last, Row{"forfeitureReserveAccountingPending": true}))
		x.market(market, Row{"deferredForfeitureQuote": a["totalDeferredQuote"], "deferredForfeitureMeme": a["totalDeferredMeme"], "forfeitureReserveAccountingPending": true})
	case "ForfeitureRecordFlushed":
		x.market(market, Row{"deferredForfeitureQuote": "0", "deferredForfeitureMeme": "0", "lastFlushedForfeitureQuote": a["quoteAmount"], "lastFlushedForfeitureMeme": a["memeAmount"], "forfeitureReserveAccountingPending": false})
	case "ActivationBucketProcessed":
		x.put("activationBuckets", key(market, get("generation")), a)
	case "StakerFeeCredited", "FeeBucketsCredited", "CurveFeesSwept":
		x.merge("feeCredits", key(get("feeId")), last)
	case "ForfeitureReserved":
		x.merge("feeCredits", key("forfeiture-reserve", market, get("feeAsset")), last)
	case "ForfeitureReserveConverted":
		x.merge("feeCredits", key("forfeiture-reserve", market, get("feeAsset")), combine(last, Row{"reserveBalance": "0"}))
	case "FeeClaimed":
		x.put("feeClaims", str(x.at["eventKey"]), a)
		claimKey := key(market, get("feeAsset"), get("beneficiaryType"), get("beneficiary"), get("beneficiaryEpoch"))
		previous := values(x.get("feeClaimTotals", claimKey))
		total, count := new(big.Int), new(big.Int)
		if old := str(previous["claimedAmount"]); old != "" {
			if _, ok := total.SetString(old, 10); !ok {
				return errors.New("invalid cumulative claimed amount")
			}
		}
		if old := str(previous["claimCount"]); old != "" {
			if _, ok := count.SetString(old, 10); !ok {
				return errors.New("invalid cumulative claim count")
			}
		}
		amount, ok := new(big.Int).SetString(get("amount"), 10)
		if !ok {
			return errors.New("invalid claim amount")
		}
		total.Add(total, amount)
		count.Add(count, big.NewInt(1))
		first := str(previous["firstClaimEventKey"])
		if first == "" {
			first = str(x.at["eventKey"])
		}
		x.put("feeClaimTotals", claimKey, Row{"marketId": a["marketId"], "feeAsset": a["feeAsset"], "beneficiaryType": a["beneficiaryType"], "beneficiary": a["beneficiary"], "beneficiaryEpoch": a["beneficiaryEpoch"], "claimedAmount": total.String(), "claimCount": count.String(), "firstClaimEventKey": first, "historyComplete": false})
	case "Swap":
		x.set("swaps", str(x.at["eventKey"]), Row{"eventKey": x.at["eventKey"], "poolId": key(get("id")), "values": copyRow(a), "provenance": x.at})
	case "V4FeeAccrued":
		for feeID, row := range x.s.tables["feeCredits"] {
			v := values(row)
			if feeID != key(get("feeId")) && v["feeNonce"] == a["feeNonce"] && strings.EqualFold(str(v["marketId"]), market) && strings.EqualFold(str(v["poolId"]), get("poolId")) {
				return errors.New("conflicting V4 fee nonce")
			}
		}
		var selected Row
		for _, swap := range x.s.tables["swaps"] {
			p := swap["provenance"].(Row)
			if swap["poolId"] == key(get("poolId")) && p["transactionHash"] == x.at["transactionHash"] && p["logIndex"].(uint64) < x.at["logIndex"].(uint64) && swap["hookFeeEventKey"] == nil {
				if selected == nil || p["logIndex"].(uint64) > selected["provenance"].(Row)["logIndex"].(uint64) {
					selected = swap
				}
			}
		}
		if selected == nil {
			return errors.New("V4 fee has no preceding unpaired Swap")
		}
		x.merge("feeCredits", key(get("feeId")), last)
		x.set("swaps", str(selected["eventKey"]), combine(selected, Row{"hookFeeEventKey": x.at["eventKey"], "feeId": key(get("feeId"))}))
	}
	return nil
}

// Changes returns owned serialized rows from the last successful Apply. Workers
// persist these rows with their event input and cursor in the same transaction.
type Change struct {
	Table string
	Key   string
	Value json.RawMessage
}

func (s *State) Changes() ([]Change, error) {
	out := []Change{}
	for table, rows := range s.changes {
		for k, row := range rows {
			data, err := json.Marshal(row)
			if err != nil {
				return nil, err
			}
			out = append(out, Change{Table: table, Key: k, Value: data})
		}
	}
	return out, nil
}
