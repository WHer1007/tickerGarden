package deployment

import (
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/events"
)

func TestMaintenanceActionABI(t *testing.T) {
	market := wordHex("01")
	trigger := wordHex("02")
	user := "0x" + strings.Repeat("a", 40)
	addressedMarket := strings.TrimPrefix(market, "0x")
	addressedUser := strings.Repeat("0", 24) + strings.TrimPrefix(user, "0x")
	tests := []struct {
		operation string
		user      string
		module    string
		signature string
		args      string
		fields    []events.Input
	}{
		{"sweep", "", "TickerGardenCurve", "sweepCurveFees()", "", []events.Input{{Name: "sweptAmount", Type: "uint256"}}},
		{"checkpoint", "", "MemeStockGauge", "checkpointActivations()", "", []events.Input{{Name: "activatedAmount", Type: "uint256"}, {Name: "processedBuckets", Type: "uint256"}}},
		{"flush-forfeiture", "", "MemeStockGauge", "flushDeferredForfeiture()", "", nil},
		{"settle-rage-quit", user, "AllocationManager", "settleRageQuitRewards(bytes32,address)", addressedMarket + addressedUser, []events.Input{{Name: "quoteForfeited", Type: "uint256"}, {Name: "memeForfeited", Type: "uint256"}, {Name: "redistributed", Type: "bool"}}},
		{"treasury-activate", "", "TreasuryDistributorV1", "activateMarket(bytes32)", addressedMarket, nil},
	}
	for _, tc := range tests {
		t.Run(tc.operation, func(t *testing.T) {
			module, signature, args, fields, err := maintenanceAction(MaintenanceRequest{Operation: tc.operation, MarketID: market, TriggerID: trigger, User: tc.user})
			if err != nil || module != tc.module || signature != tc.signature || args != tc.args || !reflect.DeepEqual(fields, tc.fields) {
				t.Fatalf("maintenanceAction() = module %q, signature %q, args %q, fields %#v, err %v; want %q, %q, %q, %#v, nil", module, signature, args, fields, err, tc.module, tc.signature, tc.args, tc.fields)
			}
		})
	}
}

func TestMaintenanceActionRejectsInvalidRequests(t *testing.T) {
	valid := MaintenanceRequest{Operation: "sweep", MarketID: wordHex("01"), TriggerID: wordHex("02")}
	cases := []struct {
		name string
		edit func(*MaintenanceRequest)
	}{
		{"unknown operation", func(r *MaintenanceRequest) { r.Operation = "unknown" }},
		{"zero market", func(r *MaintenanceRequest) { r.MarketID = zero32 }},
		{"zero trigger", func(r *MaintenanceRequest) { r.TriggerID = zero32 }},
		{"noncanonical market", func(r *MaintenanceRequest) { r.MarketID = strings.ToUpper(r.MarketID) }},
		{"noncanonical trigger", func(r *MaintenanceRequest) { r.TriggerID = strings.ToUpper(r.TriggerID) }},
		{"unexpected user", func(r *MaintenanceRequest) { r.User = "0x" + strings.Repeat("a", 40) }},
		{"zero settlement user", func(r *MaintenanceRequest) { r.Operation, r.User = "settle-rage-quit", zero20 }},
		{"invalid settlement user", func(r *MaintenanceRequest) { r.Operation, r.User = "settle-rage-quit", "0x1234" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := valid
			tc.edit(&r)
			if _, _, _, _, err := maintenanceAction(r); err == nil {
				t.Fatal("maintenanceAction accepted invalid request")
			}
		})
	}
}
