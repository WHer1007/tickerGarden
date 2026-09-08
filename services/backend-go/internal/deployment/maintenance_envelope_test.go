package deployment

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"
)

func maintenancePreviewFixture(t *testing.T) MaintenancePreview {
	t.Helper()
	base, block, markets, _, curve := businessFixture(t)
	var id string
	for key := range markets {
		id = key
	}
	block.Timestamp = "0x" + strconv.FormatInt(time.Now().Unix(), 16)
	from := "0x" + strings.Repeat("e", 40)
	f := &maintenanceFixture{
		discoveryFixture: base,
		timestamp:        block.Timestamp,
		result:           bytesWord("7"),
		wantFrom:         from,
		wantTo:           curve,
		wantData:         Hash([]byte("sweepCurveFees()"))[:10],
	}
	p, err := PreviewMaintenance(context.Background(), f, f.manifest, block, from, MaintenanceRequest{
		Operation: "sweep", MarketID: id, TriggerID: wordHex("1"),
	})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMaintenanceEnvelopeAcceptsValidAndHistoricalTimestamp(t *testing.T) {
	p := maintenancePreviewFixture(t)
	if err := ValidateMaintenancePreview(p); err != nil {
		t.Fatal(err)
	}
	p.BlockTimestamp = "0x1"
	if err := ValidateMaintenancePreview(p); err != nil {
		t.Fatalf("historical timestamp rejected: %v", err)
	}
}

func TestMaintenanceEnvelopeRejectsChangedIdentityAndExecutionState(t *testing.T) {
	cases := map[string]func(*MaintenancePreview){
		"key":        func(p *MaintenancePreview) { p.Key = "0x" + strings.Repeat("0", 64) },
		"calldata":   func(p *MaintenancePreview) { p.Data += "00" },
		"target":     func(p *MaintenancePreview) { p.To = "0x" + strings.Repeat("a", 40) },
		"from":       func(p *MaintenancePreview) { p.From = "0x" + strings.Repeat("b", 40) },
		"chain":      func(p *MaintenancePreview) { p.ChainID = 4663 },
		"status":     func(p *MaintenancePreview) { p.Status = "complete" },
		"submission": func(p *MaintenancePreview) { p.TransactionSubmission = true },
		"execution":  func(p *MaintenancePreview) { p.ExecutionComplete = true },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			p := maintenancePreviewFixture(t)
			mutate(&p)
			if err := ValidateMaintenancePreview(p); err == nil {
				t.Fatal("changed envelope accepted")
			}
		})
	}
}

func TestMaintenanceEnvelopeRejectsInvalidQuantitiesAndReturns(t *testing.T) {
	cases := map[string]func(*MaintenancePreview){
		"block quantity":     func(p *MaintenancePreview) { p.BlockNumber = "0X1" },
		"timestamp quantity": func(p *MaintenancePreview) { p.BlockTimestamp = "-1" },
		"nil returns":        func(p *MaintenancePreview) { p.ReturnValues = nil },
		"unknown return":     func(p *MaintenancePreview) { p.ReturnValues = map[string]any{"other": "7"} },
		"bad numeric":        func(p *MaintenancePreview) { p.ReturnValues["sweptAmount"] = "01" },
		"too large":          func(p *MaintenancePreview) { p.ReturnValues["sweptAmount"] = "1" + strings.Repeat("0", 78) },
		"wrong type":         func(p *MaintenancePreview) { p.ReturnValues["sweptAmount"] = float64(7) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			p := maintenancePreviewFixture(t)
			mutate(&p)
			if err := ValidateMaintenancePreview(p); err == nil {
				t.Fatal("invalid envelope accepted")
			}
		})
	}
}
