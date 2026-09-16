package readmodel

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"tickergarden/backend/internal/deployment"
)

func TestHolderObserverCandidateCompatibility(t *testing.T) {
	for _, mode := range []string{"epoch", "continuous"} {
		for _, alter := range []bool{false, true} {
			t.Run(mode+map[bool]string{true: "/altered", false: "/valid"}[alter], func(t *testing.T) {
				data, e := os.ReadFile("testdata/holders/" + mode + ".json")
				if e != nil {
					t.Fatal(e)
				}
				var b deployment.ObservationBatch
				decoder := json.NewDecoder(bytes.NewReader(data))
				decoder.UseNumber()
				if e := decoder.Decode(&b); e != nil {
					t.Fatal(e)
				}
				markets := map[string]MarketReadModel{}
				for _, o := range b.Observations {
					if o.Kind == "market" {
						markets[o.Key] = MarketReadModel{MarketID: o.Key, MemeToken: o.Value["memeToken"].(string), QuoteAsset: o.Value["quoteAsset"].(string)}
					}
					if alter && o.Kind == "holderEpoch" && o.Value["status"] == "4" {
						o.Value["fundedQuoteAmount"] = "1"
					}
					if alter && mode == "continuous" && o.Kind == "holderMarket" {
						o.Value["paid"] = "4"
					}
				}
				got, e := BuildHolderCandidates(b, markets)
				if (e == nil) == alter {
					t.Fatal("observer compatibility", e)
				}
				if alter {
					return
				}
				if len(got) != 1 {
					t.Fatal(got)
				}
				if mode == "continuous" {
					if got[0].Continuous == nil || got[0].Epoch != nil || got[0].Continuous.Funded != "3" || got[0].Continuous.Paid != "0" || got[0].Continuous.Outstanding != "3" {
						t.Fatal(got)
					}
				} else {
					if got[0].Epoch == nil || got[0].Continuous != nil || len(got[0].Epoch.Entries) != 2 {
						t.Fatal(got)
					}
					entries := got[0].Epoch.Entries
					if entries[0].Values["status"] != "3" || entries[0].Values["claimedAmount"] != "3" || entries[0].Values["outstandingQuoteAmount"] != "7" || entries[1].Values["status"] != "4" || entries[1].Values["outstandingQuoteAmount"] != "0" {
						t.Fatal(entries)
					}
				}
			})
		}
	}
}

func TestHolderCurrentFeePolicy(t *testing.T) {
	for _, mode := range []string{"valid", "uint128 max", "missing asset", "missing amount", "zero", "overflow", "noncanonical"} {
		t.Run(mode, func(t *testing.T) {
			data, e := os.ReadFile("testdata/holders/epoch.json")
			if e != nil {
				t.Fatal(e)
			}
			var b deployment.ObservationBatch
			if json.Unmarshal(data, &b) != nil {
				t.Fatal("fixture")
			}
			markets := map[string]MarketReadModel{}
			for _, o := range b.Observations {
				if o.Kind == "market" {
					markets[o.Key] = MarketReadModel{MarketID: o.Key, MemeToken: o.Value["memeToken"].(string), QuoteAsset: o.Value["quoteAsset"].(string)}
				}
				if o.Kind != "holderMarket" {
					continue
				}
				switch mode {
				case "uint128 max":
					o.Value["currentServiceFeeAmount"] = "340282366920938463463374607431768211455"
				case "missing asset":
					delete(o.Value, "currentServiceFeeAsset")
				case "missing amount":
					delete(o.Value, "currentServiceFeeAmount")
				case "zero":
					o.Value["currentServiceFeeAmount"] = "0"
				case "overflow":
					o.Value["currentServiceFeeAmount"] = "340282366920938463463374607431768211456"
				case "noncanonical":
					o.Value["currentServiceFeeAmount"] = "01"
				}
			}
			got, e := BuildHolderCandidates(b, markets)
			if (e == nil) != (mode == "valid" || mode == "uint128 max") {
				t.Fatal(mode, e)
			}
			if e == nil && (got[0].Epoch.CurrentServiceFeeAsset == "" || got[0].Epoch.CurrentServiceFeeAmount == "") {
				t.Fatal("policy omitted")
			}
		})
	}
}
