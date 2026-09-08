package settlement

import (
	"context"
	"encoding/json"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"time"
)

// ConversionQuote is the output observed from a read-only FeeVault eth_call.
// Spent can be less than RequestedMeme; ExpectedOutput is not a full-fill price.
// The one-unit probe minimum is never an execution minimum or authorization.
type ConversionQuote struct {
	Quote             Quote           `json:"quote"`
	Block             chainrpc.Header `json:"block"`
	RequestedMeme     string          `json:"requestedMeme"`
	Spent             string          `json:"spent"`
	From              string          `json:"from"`
	To                string          `json:"to"`
	PoolID            string          `json:"poolId"`
	ProbeMinimumQuote string          `json:"probeMinimumQuote"`
}

func QuoteConversion(ctx context.Context, rpc ConversionPreviewObserver, m deployment.Manifest, in ObservedInput) (ConversionQuote, error) {
	if in.Quote != nil || len(in.References) != 0 || in.SlippageBps < 0 || in.SlippageBps > 100 || in.PoolManager == nil {
		return ConversionQuote{}, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	candidate, err := ObserveCandidate(ctx, rpc, m, in, false)
	if err != nil {
		return ConversionQuote{}, err
	}
	if len(candidate.Request.Items) == 0 {
		return ConversionQuote{}, ErrQuote
	}
	observedAt := time.Now().Unix()
	// A positive one-unit floor is needed by the contract even for eth_call.
	// This temporary bound is internal and replaced by the observed output.
	probe := in
	probe.SlippageBps = 0
	probe.Quote = &Quote{ExpectedOutput: "1", QuotedAt: observedAt, RequestDigest: candidate.Request.RequestDigest, ReferenceID: "fee-vault-probe", MarketID: in.MarketID, ChainID: candidate.State.ChainID}
	planning, err := observedPlanningInput(probe, candidate.State, observedAt)
	if err != nil {
		return ConversionQuote{}, err
	}
	plan, err := BuildPlan(planning)
	if err != nil || plan.RequestDigest != candidate.Request.RequestDigest {
		return ConversionQuote{}, ErrQuote
	}
	candidate.Plan = &plan
	preview, err := simulateConversion(ctx, rpc, m, probe, candidate)
	if err != nil {
		return ConversionQuote{}, err
	}
	quote := Quote{ExpectedOutput: preview.Received, QuotedAt: observedAt, RequestDigest: candidate.Request.RequestDigest, ReferenceID: "fee-vault-eth-call:" + candidate.State.Block.Hash, MarketID: in.MarketID, ChainID: candidate.State.ChainID}
	return ConversionQuote{Quote: quote, Block: candidate.State.Block, RequestedMeme: candidate.Request.TotalMeme, Spent: preview.Spent, From: preview.From, To: preview.To, PoolID: preview.Route.PoolID, ProbeMinimumQuote: "1"}, nil
}

// VerifyAutoConversion acquires a quote, re-observes and simulates with the
// requested slippage floor, then fetches all signed independent references.
// There is no fallback to a caller's quote or to the diagnostic probe result.
func VerifyAutoConversion(ctx context.Context, rpc ConversionPreviewObserver, m deployment.Manifest, in ObservedInput, policy ReferencePolicy) (VerifiedConversion, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	quote, err := QuoteConversion(ctx, rpc, m, in)
	if err != nil {
		return VerifiedConversion{}, err
	}
	in.Quote = &quote.Quote
	verified, err := VerifyConversion(ctx, rpc, m, in, policy, true)
	if err != nil {
		return VerifiedConversion{}, err
	}
	var result map[string]json.RawMessage
	if json.Unmarshal(verified.payload, &result) != nil {
		return VerifiedConversion{}, ErrQuote
	}
	result["quoteObservation"], err = json.Marshal(quote)
	if err != nil {
		return VerifiedConversion{}, err
	}
	result["quoteAutomaticallyObserved"] = json.RawMessage("true")
	verified.payload, err = json.Marshal(result)
	if err != nil {
		return VerifiedConversion{}, err
	}
	return verified, nil
}
