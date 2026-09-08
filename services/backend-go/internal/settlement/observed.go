package settlement

import (
	"context"
	"math/big"
	"time"

	"tickergarden/backend/internal/deployment"
)

// ObservedInput contains selection limits, never claimed chain balances or time.
type ObservedInput struct {
	References   []SignedReference           `json:"references,omitempty"`
	PoolManager  *deployment.ExternalRuntime `json:"poolManager,omitempty"`
	Operator     string                      `json:"operator"`
	MarketID     string                      `json:"marketId"`
	Participants []Item                      `json:"participants"`
	PerBatchCap  string                      `json:"perBatchCap"`
	TotalMeme    string                      `json:"totalMeme"`
	Deadline     int64                       `json:"deadline"`
	SlippageBps  int                         `json:"slippageBps"`
	Quote        *Quote                      `json:"quote,omitempty"`
}
type ObservedCandidate struct {
	EvaluatedAt int64                            `json:"evaluatedAt"`
	State       deployment.RewardConversionState `json:"state"`
	Request     Request                          `json:"request"`
	Plan        *Plan                            `json:"plan,omitempty"`
}

// ObserveCandidate obtains its own state; deserialized observation files are not
// trusted evidence. Quotes remain unverified price assertions, even if bound.
func ObserveCandidate(ctx context.Context, rpc deployment.BindingObserver, manifest deployment.Manifest, in ObservedInput, withPlan bool) (ObservedCandidate, error) {
	if rpc == nil || len(in.Participants) == 0 || len(in.Participants) > 32 {
		return ObservedCandidate{}, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	people := make([]deployment.ConversionParticipant, len(in.Participants))
	for i, p := range in.Participants {
		if _, e := amount(p.MaximumMeme); e != nil {
			return ObservedCandidate{}, e
		}
		people[i] = deployment.ConversionParticipant{User: p.User, CreatorEpoch: p.CreatorEpoch}
	}
	block, e := rpc.Header(ctx, "latest")
	if e != nil {
		return ObservedCandidate{}, ErrInvalid
	}
	state, e := deployment.ObserveRewardConversionState(ctx, rpc, manifest, block, in.Operator, in.MarketID, people)
	if e != nil {
		return ObservedCandidate{}, e
	}
	input, e := observedPlanningInput(in, state, time.Now().Unix())
	if e != nil {
		return ObservedCandidate{}, e
	}
	request, e := BuildRequest(input)
	if e != nil {
		return ObservedCandidate{}, e
	}
	result := ObservedCandidate{EvaluatedAt: input.Now, State: state, Request: request}
	if withPlan {
		plan, e := BuildPlan(input)
		if e != nil {
			return ObservedCandidate{}, e
		}
		result.Plan = &plan
	}
	return result, nil
}

// Private: only the live observer supplies the state in the public workflow.
func observedPlanningInput(in ObservedInput, state deployment.RewardConversionState, now int64) (Input, error) {
	stamp, e := state.Block.Time()
	if e != nil || now < 0 || stamp > uint64(now+5) || now-int64(stamp) > 120 || len(state.Participants) != len(in.Participants) || state.Operator != in.Operator || state.MarketID != in.MarketID {
		return Input{}, ErrInvalid
	}
	// Future-tolerated chain timestamps must still bound the deadline and exits.
	if int64(stamp) > now {
		now = int64(stamp)
	}
	input := Input{ChainID: state.ChainID, MarketID: state.MarketID, Now: now, Deadline: in.Deadline, PerBatchCap: in.PerBatchCap, TotalMeme: in.TotalMeme, SlippageBps: in.SlippageBps, Quote: in.Quote, PendingParticipants: []Item{}, RawExitAt: map[string]string{}}
	for i, row := range state.Participants {
		selected := in.Participants[i]
		if row.User != selected.User || row.CreatorEpoch != selected.CreatorEpoch {
			return Input{}, ErrInvalid
		}
		maximum, e := amount(selected.MaximumMeme)
		if e != nil {
			return Input{}, e
		}
		available, e := amount(row.AvailableMeme)
		if e != nil {
			return Input{}, e
		}
		if _, e := amount(row.RawExitAt); e != nil {
			return Input{}, e
		}
		if previous, ok := input.RawExitAt[row.User]; ok && previous != row.RawExitAt {
			return Input{}, ErrInvalid
		}
		input.RawExitAt[row.User] = row.RawExitAt
		if !row.Eligible {
			maximum = new(big.Int)
		} else if available.Cmp(maximum) < 0 {
			maximum = available
		}
		input.PendingParticipants = append(input.PendingParticipants, Item{User: row.User, CreatorEpoch: row.CreatorEpoch, MaximumMeme: maximum.String()})
	}
	return input, nil
}
