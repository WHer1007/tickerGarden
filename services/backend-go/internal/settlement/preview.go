package settlement

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
)

const conversionSignature = "settleRewards(bytes32,(address,uint32,uint256)[],uint256,uint256)"

var ErrSimulation = errors.New("reward conversion simulation unavailable or inconsistent")

type ConversionAllocation struct {
	User          string `json:"user"`
	CreatorEpoch  uint32 `json:"creatorEpoch"`
	MemeSpent     string `json:"memeSpent"`
	MemeRefund    string `json:"memeRefund"`
	QuoteReceived string `json:"quoteReceived"`
}
type ConversionPreview struct {
	AssetCoverage []deployment.ConversionAssetCoverage `json:"assetCoverage"`
	Route         deployment.RewardConversionRoute     `json:"route"`
	Candidate     ObservedCandidate                    `json:"candidate"`
	From          string                               `json:"from"`
	To            string                               `json:"to"`
	Data          string                               `json:"data"`
	Value         string                               `json:"value"`
	Spent         string                               `json:"spent"`
	Received      string                               `json:"received"`
	Allocations   []ConversionAllocation               `json:"allocations"`
}

// PreviewConversion simulates only the authenticated FeeVault's fixed ABI at
// the exact observed block. Outputs are hypothetical, not receipt evidence.
type ConversionPreviewObserver interface {
	deployment.MaintenanceObserver
	deployment.ConversionBalanceObserver
}

func PreviewConversion(ctx context.Context, rpc ConversionPreviewObserver, m deployment.Manifest, in ObservedInput) (ConversionPreview, error) {
	if rpc == nil || in.PoolManager == nil {
		return ConversionPreview{}, ErrSimulation
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	c, e := ObserveCandidate(ctx, rpc, m, in, true)
	if e != nil {
		return ConversionPreview{}, e
	}
	return simulateConversion(ctx, rpc, m, in, c)
}

// Shared fixed-block simulation. Callers must obtain c from live observation,
// never from imported JSON. Quote probing uses the same identity/coverage gates.
func simulateConversion(ctx context.Context, rpc ConversionPreviewObserver, m deployment.Manifest, in ObservedInput, c ObservedCandidate) (ConversionPreview, error) {
	if c.Plan == nil || len(c.Plan.Batches) != 1 {
		return ConversionPreview{}, ErrSimulation
	}
	total, e := amount(c.Request.TotalMeme)
	if e != nil || total.Cmp(new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 127), big.NewInt(1))) > 0 {
		return ConversionPreview{}, ErrSimulation
	}
	route, e := deployment.ObserveRewardConversionRoute(ctx, rpc, m, c.State.Block, in.MarketID, *in.PoolManager)
	if e != nil {
		return ConversionPreview{}, e
	}
	coverage, e := deployment.ObserveConversionCoverage(ctx, rpc, m, c.State.Block, in.MarketID)
	if e != nil {
		return ConversionPreview{}, e
	}
	covered, e := amount(coverage[0].TotalLiability)
	if e != nil || covered.Cmp(total) < 0 {
		return ConversionPreview{}, ErrSimulation
	}
	b := c.Plan.Batches[0]
	stamp, e := c.State.Block.Time()
	if e != nil || b.Deadline < int64(stamp) || b.Deadline-int64(stamp) > 300 {
		return ConversionPreview{}, ErrSimulation
	}
	data, e := conversionData(b)
	if e != nil {
		return ConversionPreview{}, e
	}
	raw, e := rpc.SimulateAt(ctx, c.State.Operator, c.State.FeeVault, data, c.State.Block.Hash)
	if e != nil {
		return ConversionPreview{}, ErrSimulation
	}
	fields, e := events.DecodeStatic([]events.Input{{Name: "spent", Type: "uint256"}, {Name: "received", Type: "uint256"}}, raw)
	if e != nil {
		return ConversionPreview{}, ErrSimulation
	}
	spent, received := fields["spent"].(string), fields["received"].(string)
	allocations, e := conversionAllocations(c.Request, b.MinimumQuote, spent, received)
	if e != nil {
		return ConversionPreview{}, e
	}
	last, e := rpc.Header(ctx, c.State.Block.Number)
	now := time.Now().Unix()
	if e != nil || last != c.State.Block || now-int64(stamp) > 120 || int64(stamp) > now+5 || now > b.Deadline || in.Quote == nil || now-in.Quote.QuotedAt > 30 {
		return ConversionPreview{}, ErrSimulation
	}
	return ConversionPreview{AssetCoverage: coverage, Route: route, Candidate: c, From: c.State.Operator, To: c.State.FeeVault, Data: data, Value: "0x0", Spent: spent, Received: received, Allocations: allocations}, nil
}

func conversionData(b Batch) (string, error) {
	if !hashPattern.MatchString(b.MarketID) || len(b.Items) == 0 || len(b.Items) > 32 || b.Deadline < 0 {
		return "", ErrInvalid
	}
	min, e := amount(b.MinimumQuote)
	if e != nil || min.Sign() == 0 {
		return "", ErrInvalid
	}
	var data strings.Builder
	data.WriteString(deployment.Hash([]byte(conversionSignature))[:10])
	data.WriteString(b.MarketID[2:])
	fmt.Fprintf(&data, "%064x%064x%064x%064x", 128, min, b.Deadline, len(b.Items))
	seen := map[deployment.ConversionParticipant]bool{}
	for _, p := range b.Items {
		n, e := amount(p.MaximumMeme)
		key := deployment.ConversionParticipant{User: p.User, CreatorEpoch: p.CreatorEpoch}
		if e != nil || n.Sign() == 0 || !validAddress(p.User) || seen[key] {
			return "", ErrInvalid
		}
		seen[key] = true
		data.WriteString(strings.Repeat("0", 24) + p.User[2:])
		fmt.Fprintf(&data, "%064x%064x", p.CreatorEpoch, n)
	}
	return data.String(), nil
}

// Mirrors cumulative floor allocation in ProtocolFeeVaultRewardSettlement.
func conversionAllocations(r Request, minimum, spent, received string) ([]ConversionAllocation, error) {
	total, e := amount(r.TotalMeme)
	if e != nil || total.Sign() == 0 {
		return nil, ErrSimulation
	}
	used, e := amount(spent)
	if e != nil || used.Sign() == 0 || used.Cmp(total) > 0 {
		return nil, ErrSimulation
	}
	output, e := amount(received)
	if e != nil {
		return nil, ErrSimulation
	}
	min, e := amount(minimum)
	if e != nil || min.Sign() == 0 || output.Cmp(min) < 0 {
		return nil, ErrSimulation
	}
	cumulative, prevSpent, prevQuote := new(big.Int), new(big.Int), new(big.Int)
	rows := make([]ConversionAllocation, 0, len(r.Items))
	for _, p := range r.Items {
		n, e := amount(p.MaximumMeme)
		if e != nil || n.Sign() == 0 {
			return nil, ErrSimulation
		}
		cumulative.Add(cumulative, n)
		allocated := new(big.Int).Div(new(big.Int).Mul(cumulative, used), total)
		quote := new(big.Int).Div(new(big.Int).Mul(allocated, output), used)
		delta := new(big.Int).Sub(allocated, prevSpent)
		payout := new(big.Int).Sub(quote, prevQuote)
		refund := new(big.Int).Sub(n, delta)
		if refund.Sign() < 0 || (delta.Sign() > 0 && payout.Sign() == 0) {
			return nil, ErrSimulation
		}
		rows = append(rows, ConversionAllocation{User: p.User, CreatorEpoch: p.CreatorEpoch, MemeSpent: delta.String(), MemeRefund: refund.String(), QuoteReceived: payout.String()})
		prevSpent, prevQuote = allocated, quote
	}
	if cumulative.Cmp(total) != 0 || prevSpent.Cmp(used) != 0 || prevQuote.Cmp(output) != 0 {
		return nil, ErrSimulation
	}
	return rows, nil
}
