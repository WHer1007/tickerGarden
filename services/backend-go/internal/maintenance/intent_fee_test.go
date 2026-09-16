package maintenance

import (
	"testing"

	"tickergarden/backend/internal/deployment"
)

func TestIntentCallFeesAndBounds(t *testing.T) {
	p := deployment.MaintenancePreview{From: "0xfrom", To: "0xto", Data: "0xdata"}
	r := Reservation{Nonce: "15"}

	call, cost, err := intentCall(p, r, Fees{
		GasLimit:             "21000",
		MaxFeePerGas:         "100",
		MaxPriorityFeePerGas: "0",
	})
	if err != nil {
		t.Fatalf("intentCall() error = %v", err)
	}
	want := map[string]string{
		"from":     "0xfrom",
		"to":       "0xto",
		"data":     "0xdata",
		"value":    "0x0",
		"gas":      "0x5208",
		"nonce":    "0xf",
		"maxFee":   "0x64",
		"priority": "0x0",
	}
	if call.From != want["from"] || call.To != want["to"] || call.Data != want["data"] || call.Value != want["value"] || call.Gas != want["gas"] || call.Nonce != want["nonce"] || call.MaxFeePerGas != want["maxFee"] || call.MaxPriorityFeePerGas != want["priority"] {
		t.Errorf("intentCall() call = %+v, want fields %+v", call, want)
	}
	if cost != "2100000" {
		t.Errorf("intentCall() cost = %q, want %q", cost, "2100000")
	}
}

func TestIntentCallRejectsInvalidFeeAndNonceBounds(t *testing.T) {
	p := deployment.MaintenancePreview{}
	cases := []struct {
		name  string
		fees  Fees
		nonce string
	}{
		{"noncanonical decimal", Fees{"021000", "1", "0"}, "0"},
		{"gas below minimum", Fees{"20999", "1", "0"}, "0"},
		{"gas uint63 overflow", Fees{"9223372036854775808", "1", "0"}, "0"},
		{"zero max fee", Fees{"21000", "0", "0"}, "0"},
		{"priority exceeds max", Fees{"21000", "1", "2"}, "0"},
		{"cost uint256 overflow", Fees{"9223372036854775807", "25108406941546723055343157692830665664409421777856138051584", "0"}, "0"},
		{"noncanonical nonce", Fees{"21000", "1", "0"}, "01"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := intentCall(p, Reservation{Nonce: tc.nonce}, tc.fees); err == nil {
				t.Fatal("intentCall() error = nil, want error")
			}
		})
	}
}
