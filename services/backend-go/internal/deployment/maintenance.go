package deployment

import (
	"context"
	"errors"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

// MaintenanceRequest contains no caller-selected target, selector or value.
type MaintenanceRequest struct {
	Operation string `json:"operation"`
	MarketID  string `json:"marketId"`
	TriggerID string `json:"triggerId"`
	User      string `json:"user,omitempty"`
}
type MaintenancePreview struct {
	GenesisHash           string             `json:"genesisHash"`
	BlockTimestamp        string             `json:"blockTimestamp"`
	Request               MaintenanceRequest `json:"request"`
	Key                   string             `json:"key"`
	ChainID               uint64             `json:"chainId"`
	BlockNumber           string             `json:"blockNumber"`
	BlockHash             string             `json:"blockHash"`
	From                  string             `json:"from"`
	To                    string             `json:"to"`
	Data                  string             `json:"data"`
	Value                 string             `json:"value"`
	Module                string             `json:"module"`
	Signature             string             `json:"signature"`
	ReturnValues          map[string]any     `json:"returnValues"`
	Status                string             `json:"status"`
	TransactionSubmission bool               `json:"transactionSubmission"`
	ExecutionComplete     bool               `json:"executionComplete"`
}
type MaintenanceObserver interface {
	BindingObserver
	SimulateAt(context.Context, string, string, string, string) ([]byte, error)
}

func maintenanceAction(r MaintenanceRequest) (module, signature, args string, fields []events.Input, err error) {
	if !hex32.MatchString(r.MarketID) || r.MarketID == zero32 || !hex32.MatchString(r.TriggerID) || r.TriggerID == zero32 || (r.Operation != "settle-rage-quit" && r.User != "") {
		err = errors.New("invalid maintenance request")
		return
	}
	switch r.Operation {
	case "sweep":
		module, signature = "TickerGardenCurve", "sweepCurveFees()"
		fields = []events.Input{{Name: "sweptAmount", Type: "uint256"}}
	case "checkpoint":
		module, signature = "MemeStockGauge", "checkpointActivations()"
		fields = []events.Input{{Name: "activatedAmount", Type: "uint256"}, {Name: "processedBuckets", Type: "uint256"}}
	case "flush-forfeiture":
		module, signature = "MemeStockGauge", "flushDeferredForfeiture()"
	case "settle-rage-quit":
		if !hex20.MatchString(r.User) || r.User == zero20 {
			err = errors.New("invalid settlement user")
			return
		}
		module, signature, args = "AllocationManager", "settleRageQuitRewards(bytes32,address)", r.MarketID[2:]+addressArgument(r.User)
		fields = []events.Input{{Name: "quoteForfeited", Type: "uint256"}, {Name: "memeForfeited", Type: "uint256"}, {Name: "redistributed", Type: "bool"}}
	case "treasury-activate":
		module, signature, args = "TreasuryDistributorV1", "activateMarket(bytes32)", r.MarketID[2:]
	default:
		err = errors.New("unsupported maintenance operation")
	}
	return
}

// PreviewMaintenance authenticates an explicitly manifested runtime and its
// market binding, then simulates at one recent canonical block. The key is a
// scoped request identity only, not a durable reservation or submission record.
func PreviewMaintenance(ctx context.Context, rpc MaintenanceObserver, m Manifest, block chainrpc.Header, from string, r MaintenanceRequest) (MaintenancePreview, error) {
	fail := func(e error) (MaintenancePreview, error) { return MaintenancePreview{}, e }
	module, signature, args, fields, err := maintenanceAction(r)
	if err != nil {
		return fail(err)
	}
	if !hex20.MatchString(from) || from == zero20 {
		return fail(errors.New("invalid maintenance sender"))
	}
	timestamp, err := block.Time()
	now := time.Now().Unix()
	if err != nil || timestamp > uint64(now+5) || now-int64(timestamp) > 120 {
		return fail(errors.New("maintenance block is not fresh"))
	}
	target, err := maintenanceTarget(ctx, rpc, m, block, r, module)
	if err != nil {
		return fail(err)
	}
	if time.Now().Unix()-int64(timestamp) > 120 {
		return fail(errors.New("maintenance block expired before simulation"))
	}
	data := Hash([]byte(signature))[:10] + args
	raw, err := rpc.SimulateAt(ctx, from, target, data, block.Hash)
	if err != nil {
		return fail(errors.New("maintenance simulation failed"))
	}
	values, err := events.DecodeStatic(fields, raw)
	if err != nil {
		return fail(errors.New("maintenance simulation returned invalid ABI"))
	}
	last, err := rpc.Header(ctx, block.Number)
	if err != nil || last.Hash != block.Hash || last.Timestamp != block.Timestamp || time.Now().Unix()-int64(timestamp) > 120 {
		return fail(errors.New("maintenance simulation block changed"))
	}
	key := Hash([]byte(strings.Join([]string{"V1-EXEC-11:maintenance-v1", strconv.FormatUint(m.ChainID, 10), m.GenesisHash, from, module, target, r.Operation, r.MarketID, r.User, r.TriggerID}, ":")))
	return MaintenancePreview{GenesisHash: m.GenesisHash, BlockTimestamp: block.Timestamp, Request: r, Key: key, ChainID: m.ChainID, BlockNumber: block.Number, BlockHash: block.Hash, From: from, To: target, Data: data, Value: "0x0", Module: module, Signature: signature, ReturnValues: values, Status: "simulated", TransactionSubmission: false, ExecutionComplete: false}, nil
}

var maintenanceUint = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

// ValidateMaintenancePreview checks stored envelope consistency, not independent
// chain authenticity. Only PreviewMaintenance supplies live authentication.
func ValidateMaintenancePreview(p MaintenancePreview) error {
	fail := errors.New("invalid maintenance preview envelope")
	module, signature, args, fields, err := maintenanceAction(p.Request)
	if err != nil || module != p.Module || signature != p.Signature || p.Data != Hash([]byte(signature))[:10]+args || p.Value != "0x0" || p.Status != "simulated" || p.TransactionSubmission || p.ExecutionComplete {
		return fail
	}
	if (p.ChainID != 4663 && p.ChainID != 46630 && p.ChainID != 421614) || !hex32.MatchString(p.GenesisHash) || !hex32.MatchString(p.BlockHash) || !hex20.MatchString(p.From) || p.From == zero20 || !hex20.MatchString(p.To) || p.To == zero20 {
		return fail
	}
	if _, err = chainrpc.Quantity(p.BlockNumber); err != nil {
		return fail
	}
	if _, err = chainrpc.Quantity(p.BlockTimestamp); err != nil {
		return fail
	}
	key := Hash([]byte(strings.Join([]string{"V1-EXEC-11:maintenance-v1", strconv.FormatUint(p.ChainID, 10), p.GenesisHash, p.From, p.Module, p.To, p.Request.Operation, p.Request.MarketID, p.Request.User, p.Request.TriggerID}, ":")))
	if p.Key != key || p.ReturnValues == nil || len(p.ReturnValues) != len(fields) {
		return fail
	}
	for _, field := range fields {
		value, ok := p.ReturnValues[field.Name]
		if !ok {
			return fail
		}
		if field.Type == "bool" {
			if _, ok := value.(bool); !ok {
				return fail
			}
			continue
		}
		s, ok := value.(string)
		if !ok || !maintenanceUint.MatchString(s) {
			return fail
		}
		n, ok := new(big.Int).SetString(s, 10)
		if !ok || n.BitLen() > 256 {
			return fail
		}
	}
	return nil
}

// DecodeMaintenanceReturn applies the fixed operation's return ABI to an exact
// gas/fee simulation, without accepting a caller-provided ABI.
func DecodeMaintenanceReturn(r MaintenanceRequest, raw []byte) (map[string]any, error) {
	_, _, _, fields, e := maintenanceAction(r)
	if e != nil {
		return nil, e
	}
	return events.DecodeStatic(fields, raw)
}

// maintenanceTarget authenticates the runtime and market graph at a pinned block.
func maintenanceTarget(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, r MaintenanceRequest, module string) (string, error) {
	if _, err := VerifyCoreBindings(ctx, rpc, m, block); err != nil {
		return "", err
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		if c.Module == "MarketRegistryV1" || c.Module == "AllocationManager" || c.Module == "TickerGardenFactoryV1" {
			roots[c.Module] = c.Address
		}
	}
	read := businessReader(ctx, rpc, block)
	state, err := read(roots["MarketRegistryV1"], "market(bytes32)", r.MarketID[2:], marketFields)
	if err != nil {
		return "", err
	}
	if err = validateMarketState(state); err != nil {
		return "", err
	}
	reverse, err := read(roots["MarketRegistryV1"], "marketIdByToken(address)", addressArgument(state["memeToken"].(string)), []events.Input{{Name: "id", Type: "bytes32"}})
	if err != nil || reverse["id"] != r.MarketID {
		return "", errors.New("maintenance market reverse binding mismatch")
	}
	target := roots[module]
	switch module {
	case "TickerGardenCurve":
		target = state["curve"].(string)
	case "MemeStockGauge":
		if state["stakingEnabled"] != true {
			return "", errors.New("maintenance gauge is disabled")
		}
		target = state["gauge"].(string)
	case "TreasuryDistributorV1":
		value, e := read(roots["TickerGardenFactoryV1"], "treasuryDistributor()", "", []events.Input{{Name: "address", Type: "address"}})
		if e != nil {
			return "", e
		}
		target = value["address"].(string)
		value, e = read(target, "marketRegistry()", "", []events.Input{{Name: "address", Type: "address"}})
		if e != nil || value["address"] != roots["MarketRegistryV1"] {
			return "", errors.New("maintenance treasury registry mismatch")
		}
	}
	bound := false
	for _, c := range m.Contracts {
		if c.Module == module && c.Address == target {
			bound = true
		}
	}
	if !bound || target == zero20 {
		return "", errors.New("maintenance target requires an explicit runtime manifest entry")
	}
	return target, nil
}
