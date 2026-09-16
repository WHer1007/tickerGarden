package deployment

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

// MaintenancePoststate is block-end state evidence. It does not establish
// transaction inclusion, finality, or exclusive causation by one transaction.
// The receipt workflow must combine those independent checks before completion.
type MaintenancePoststate struct {
	Request     MaintenanceRequest `json:"request"`
	ChainID     uint64             `json:"chainId"`
	GenesisHash string             `json:"genesisHash"`
	Block       chainrpc.Header    `json:"block"`
	Target      string             `json:"target"`
	Module      string             `json:"module"`
	Values      map[string]any     `json:"values"`
	Satisfied   bool               `json:"satisfied"`
}

// ObserveMaintenancePoststate authenticates historical block state without
// simulating the operation again: activation/settlement may no longer be callable.
func ObserveMaintenancePoststate(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, r MaintenanceRequest, expectedTarget string) (MaintenancePoststate, error) {
	bad := errors.New("maintenance poststate unavailable")
	module, _, _, _, e := maintenanceAction(r)
	if e != nil {
		return MaintenancePoststate{}, e
	}
	timestamp, e := block.Time()
	if e != nil {
		return MaintenancePoststate{}, bad
	}
	target, e := maintenanceTarget(ctx, rpc, m, block, r, module)
	if e != nil || (expectedTarget != "" && target != expectedTarget) {
		return MaintenancePoststate{}, bad
	}
	read := businessReader(ctx, rpc, block)
	var values map[string]any
	satisfied := true
	switch r.Operation {
	case "sweep":
		values, e = read(target, "accruedCurveFees()", "", []events.Input{{Name: "accruedCurveFees", Type: "uint256"}})
		if e == nil {
			satisfied = values["accruedCurveFees"] == "0"
		}
	case "flush-forfeiture":
		values, e = read(target, "deferredForfeiture()", "", []events.Input{{Name: "quoteAmount", Type: "uint256"}, {Name: "memeAmount", Type: "uint256"}})
		if e == nil {
			satisfied = values["quoteAmount"] == "0" && values["memeAmount"] == "0"
		}
	case "settle-rage-quit":
		values, e = read(target, "rageQuitSettlementPending(bytes32,address)", r.MarketID[2:]+addressArgument(r.User), []events.Input{{Name: "pending", Type: "bool"}, {Name: "principal", Type: "uint256"}})
		if e == nil {
			satisfied = values["pending"] == false && values["principal"] == "0"
		}
	case "treasury-activate":
		values, e = read(target, "market(bytes32)", r.MarketID[2:], treasuryMarketFields)
		if e == nil {
			activated, err := strconv.ParseUint(values["activatedAt"].(string), 10, 64)
			if err != nil || activated > timestamp {
				return MaintenancePoststate{}, bad
			}

			registry := ""
			for _, c := range m.Contracts {
				if c.Module == "MarketRegistryV1" {
					registry = c.Address
				}
			}
			canonical, err := read(registry, "market(bytes32)", r.MarketID[2:], marketFields)
			if err != nil || values["memeToken"] != canonical["memeToken"] || values["quoteToken"] != canonical["quoteAsset"] {
				return MaintenancePoststate{}, bad
			}
			satisfied = activated != 0
		}
	case "checkpoint":
		values = map[string]any{}
		for i := 0; i < 32; i++ {
			slot, err := read(target, "activationSlot(uint8)", fmt.Sprintf("%064x", i), []events.Input{{Name: "generation", Type: "uint64"}, {Name: "amount", Type: "uint256"}, {Name: "refs", Type: "uint256"}})
			if err != nil {
				return MaintenancePoststate{}, bad
			}
			generation, err := strconv.ParseUint(slot["generation"].(string), 10, 64)
			if err != nil {
				return MaintenancePoststate{}, bad
			}
			if generation == 0 {
				if slot["amount"] != "0" || slot["refs"] != "0" {
					return MaintenancePoststate{}, bad
				}
			} else {
				if slot["amount"] == "0" || slot["refs"] == "0" {
					return MaintenancePoststate{}, bad
				}
				if generation <= timestamp {
					satisfied = false
				}
			}
			values[strconv.Itoa(i)] = slot
		}
	}
	if e != nil {
		return MaintenancePoststate{}, bad
	}
	last, e := rpc.Header(ctx, block.Number)
	if e != nil || last.Hash != block.Hash || last.Timestamp != block.Timestamp {
		return MaintenancePoststate{}, bad
	}
	return MaintenancePoststate{Request: r, ChainID: m.ChainID, GenesisHash: m.GenesisHash, Block: block, Target: target, Module: module, Values: values, Satisfied: satisfied}, nil
}
