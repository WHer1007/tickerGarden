package treasury

import (
	"strconv"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestCandidateRequestEveryDomain(t *testing.T) {
	for _, name := range []string{"valid", "chain", "distributor", "market", "epoch", "duration", "schema", "meme", "quote", "policy", "source number", "source hash", "funding", "start", "end", "source time", "exclusions"} {
		t.Run(name, func(t *testing.T) {
			in := goldens(t)[0].Input
			request := deployment.TreasuryRequestSnapshot{ChainID: 1, Distributor: in.Distributor, MarketID: in.MarketID, EpochID: in.EpochID, EpochDuration: strconv.FormatUint(Duration, 10), TwabSchema: twabSchema, SourceTimestamp: in.SourceBlockTimestamp, Market: map[string]any{"memeToken": in.MemeToken, "quoteToken": in.QuoteToken, "eligibilityPolicyHash": in.EligibilityPolicyHash}, Epoch: map[string]any{"sourceBlockNumber": in.SourceBlockNumber, "sourceBlockHash": in.SourceBlockHash, "quoteAmount": in.QuoteAmount}, Window: map[string]any{"start": in.WindowStart, "end": in.WindowEnd}}
			switch name {
			case "chain":
				request.ChainID++
			case "distributor":
				request.Distributor = zero
			case "market":
				request.MarketID = "bad"
			case "epoch":
				request.EpochID++
			case "duration":
				request.EpochDuration = "2592000"
			case "schema":
				request.TwabSchema = "bad"
			case "meme":
				request.Market["memeToken"] = zero
			case "quote":
				request.Market["quoteToken"] = zero
			case "policy":
				request.Market["eligibilityPolicyHash"] = "bad"
			case "source number":
				request.Epoch["sourceBlockNumber"] = "1"
			case "source hash":
				request.Epoch["sourceBlockHash"] = "bad"
			case "funding":
				request.Epoch["quoteAmount"] = "1"
			case "start":
				request.Window["start"] = "1"
			case "end":
				request.Window["end"] = "1"
			case "source time":
				request.SourceTimestamp = "1"
			case "exclusions":
				in.ExcludedAccounts = []string{}
			}
			e := MatchRequest(in, request)
			if (name == "valid") != (e == nil) {
				t.Fatal(name, e)
			}
		})
	}
}
