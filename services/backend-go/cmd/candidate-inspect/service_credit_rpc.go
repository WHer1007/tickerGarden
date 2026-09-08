package main

import (
	"context"
	"errors"
	"math/big"
	"regexp"
	"strings"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/readmodel"
)

// Called after Holder distributor/treasury RPC binding, before the final header
// and finality recheck. History inventory comes from the local replay, not input JSON.
func verifyCandidateServiceCredits(ctx context.Context, rpc deployment.BindingObserver, c readmodel.CandidateSet) error {
	bad := errors.New("candidate service credit differs from RPC")
	distributors := map[string]bool{}
	for _, holder := range c.HolderMarkets {
		if holder.Mode == "epoch" {
			distributors[holder.Distributor] = true
		}
	}
	if len(c.ServiceCredits) > readmodel.MaxServiceCreditReads || (len(distributors) > 0 && !c.ServiceCreditHistoryVerified) {
		return bad
	}
	address := regexp.MustCompile(`^0x[0-9a-f]{40}$`)
	hash := regexp.MustCompile(`^0x[0-9a-f]{64}$`)
	if !hash.MatchString(c.BlockHash) {
		return bad
	}
	seen := map[string]bool{}
	for _, credit := range c.ServiceCredits {
		if !distributors[credit.Distributor] || !address.MatchString(credit.Distributor) || !address.MatchString(credit.Asset) || !address.MatchString(credit.Beneficiary) || credit.Beneficiary == "0x"+strings.Repeat("0", 40) || credit.Beneficiary == credit.Distributor {
			return bad
		}
		if len(credit.Amount) > 78 {
			return bad
		}
		amount, ok := new(big.Int).SetString(credit.Amount, 10)
		if !ok || amount.Sign() < 0 || amount.BitLen() > 256 || amount.String() != credit.Amount {
			return bad
		}
		key := credit.Distributor + ":" + credit.Asset + ":" + credit.Beneficiary
		if seen[key] {
			return bad
		}
		seen[key] = true
		args := strings.Repeat("0", 24) + credit.Asset[2:] + strings.Repeat("0", 24) + credit.Beneficiary[2:]
		raw, err := rpc.CallAt(ctx, credit.Distributor, deployment.Hash([]byte("serviceCredit(address,address)"))[:10]+args, c.BlockHash)
		if err != nil {
			return bad
		}
		decoded, err := events.DecodeStatic([]events.Input{{Name: "amount", Type: "uint256"}}, raw)
		if err != nil || decoded["amount"] != credit.Amount {
			return bad
		}
	}
	return nil
}
