package treasury

import (
	"errors"
	"strconv"

	"tickergarden/backend/internal/deployment"
)

// MatchRequest binds every candidate claim-domain value to the observed request.
// Publication still requires fresh simulation, review and separate authority.
func MatchRequest(in Input, request deployment.TreasuryRequestSnapshot) error {
	c := normalizedContext(in.Context)
	if strconv.FormatUint(request.ChainID, 10) != c.ChainID || request.Distributor != c.Distributor || request.MarketID != c.MarketID || request.EpochID != c.EpochID || request.EpochDuration != strconv.FormatUint(Duration, 10) || request.TwabSchema != twabSchema {
		return errors.New("Treasury candidate request domain mismatch")
	}
	for _, pair := range [][2]string{{c.MemeToken, "memeToken"}, {c.QuoteToken, "quoteToken"}, {c.EligibilityPolicyHash, "eligibilityPolicyHash"}} {
		if request.Market[pair[1]] != pair[0] {
			return errors.New("Treasury candidate market or exclusion policy mismatch")
		}
	}
	for _, pair := range [][2]string{{c.SourceBlockNumber, "sourceBlockNumber"}, {c.SourceBlockHash, "sourceBlockHash"}, {in.QuoteAmount, "quoteAmount"}} {
		if request.Epoch[pair[1]] != pair[0] {
			return errors.New("Treasury candidate source or funding mismatch")
		}
	}
	if request.Window["start"] != c.WindowStart || request.Window["end"] != c.WindowEnd || request.SourceTimestamp != in.SourceBlockTimestamp {
		return errors.New("Treasury candidate window mismatch")
	}
	policy, e := PolicyHash(c.ChainID, c.MarketID, in.ExcludedAccounts)
	if e != nil || policy != c.EligibilityPolicyHash {
		return errors.New("Treasury exclusion policy mismatch")
	}
	return nil
}
