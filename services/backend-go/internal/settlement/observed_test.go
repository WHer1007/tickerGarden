package settlement

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

const observedMarket = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

func observedFixture(t *testing.T) (ObservedInput, deployment.RewardConversionState, int64) {
	t.Helper()
	now := time.Now().Unix()
	u1 := "0x0000000000000000000000000000000000000001"
	u2 := "0x0000000000000000000000000000000000000002"
	in := ObservedInput{Operator: "0x0000000000000000000000000000000000000011", MarketID: observedMarket,
		Participants: []Item{{User: u1, CreatorEpoch: 0, MaximumMeme: "10"}, {User: u2, CreatorEpoch: 7, MaximumMeme: "20"}},
		PerBatchCap:  "100", TotalMeme: "100", Deadline: now + 60, SlippageBps: 10}
	state := deployment.RewardConversionState{ChainID: 4663, Operator: in.Operator, MarketID: in.MarketID,
		Block: chainrpc.Header{Timestamp: fmt.Sprintf("0x%x", now-1), Number: "0x10", Hash: "0x" + strings.Repeat("11", 32)},
		Participants: []deployment.ConversionParticipantState{
			{ConversionParticipant: deployment.ConversionParticipant{User: u1, CreatorEpoch: 0}, AvailableMeme: "7", RawExitAt: "0", Eligible: true},
			{ConversionParticipant: deployment.ConversionParticipant{User: u2, CreatorEpoch: 7}, AvailableMeme: "99", RawExitAt: "0", Eligible: true},
		}}
	// Header.Hash is only carried through this private helper; planner does not inspect it.
	return in, state, now
}

func TestObservedPlanningInputClipsEligibilityAndRoles(t *testing.T) {
	in, state, now := observedFixture(t)
	state.Participants[1].Eligible = false
	got, err := observedPlanningInput(in, state, now)
	if err != nil {
		t.Fatal(err)
	}
	want := []Item{{User: in.Participants[0].User, MaximumMeme: "7"}, {User: in.Participants[1].User, CreatorEpoch: 7, MaximumMeme: "0"}}
	if !reflect.DeepEqual(got.PendingParticipants, want) {
		t.Fatalf("participants = %#v, want %#v", got.PendingParticipants, want)
	}
	if _, err = BuildRequest(got); err != nil {
		t.Fatal(err)
	}
	if _, err = BuildPlan(got); err == nil {
		t.Fatal("expected unquoted non-empty plan to be rejected")
	}
}

func TestObservedPlanningInputMatureExitAndBuildsEmptyPlan(t *testing.T) {
	in, state, now := observedFixture(t)
	state.Participants[0].RawExitAt = strconv.FormatInt(now, 10)
	state.Participants[1].RawExitAt = strconv.FormatInt(now, 10)
	got, err := observedPlanningInput(in, state, now)
	if err != nil {
		t.Fatal(err)
	}
	if got.PendingParticipants[0].MaximumMeme != "7" {
		t.Fatalf("mature exit should remain observable: %#v", got.PendingParticipants)
	}
	p, err := BuildPlan(got)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Items) != 0 {
		t.Fatalf("mature exit should produce empty plan: %#v", p)
	}
}

func TestObservedPlanningInputRejectsStaleFutureAndMismatches(t *testing.T) {
	for name, mutate := range map[string]func(*ObservedInput, *deployment.RewardConversionState, int64){
		"stale": func(_ *ObservedInput, s *deployment.RewardConversionState, n int64) {
			s.Block.Timestamp = fmt.Sprintf("0x%x", n-121)
		},
		"future": func(_ *ObservedInput, s *deployment.RewardConversionState, n int64) {
			s.Block.Timestamp = fmt.Sprintf("0x%x", n+6)
		},
		"operator": func(i *ObservedInput, _ *deployment.RewardConversionState, _ int64) {
			i.Operator = "0x0000000000000000000000000000000000000099"
		},
		"market": func(i *ObservedInput, _ *deployment.RewardConversionState, _ int64) {
			i.MarketID = "0x" + "ff" + observedMarket[4:]
		},
		"participant": func(_ *ObservedInput, s *deployment.RewardConversionState, _ int64) {
			s.Participants[0].User = "0x0000000000000000000000000000000000000099"
		},
		"order": func(_ *ObservedInput, s *deployment.RewardConversionState, _ int64) {
			s.Participants[0], s.Participants[1] = s.Participants[1], s.Participants[0]
		},
	} {
		t.Run(name, func(t *testing.T) {
			i, s, n := observedFixture(t)
			mutate(&i, &s, n)
			if _, err := observedPlanningInput(i, s, n); err == nil {
				t.Fatal("accepted mismatch")
			}
		})
	}
}

func TestObservedPlanningInputDoesNotAliasAndQuoteDigestBindsAmount(t *testing.T) {
	in, state, now := observedFixture(t)
	got, err := observedPlanningInput(in, state, now)
	if err != nil {
		t.Fatal(err)
	}
	if got.PendingParticipants[1].MaximumMeme != "20" {
		t.Fatal("selection cap not preserved")
	}
	original := got.PendingParticipants[0].MaximumMeme
	in.Participants[0].MaximumMeme = "999"
	state.Participants[0].AvailableMeme = "1"
	if got.PendingParticipants[0].MaximumMeme != original {
		t.Fatal("input/state aliased output")
	}
	r, err := BuildRequest(got)
	if err != nil {
		t.Fatal(err)
	}
	got.Quote = &Quote{ExpectedOutput: "100", QuotedAt: now, RequestDigest: r.RequestDigest, ReferenceID: "ref", MarketID: got.MarketID, ChainID: got.ChainID}
	if _, err = BuildPlan(got); err != nil {
		t.Fatal(err)
	}
	got.PendingParticipants[0].MaximumMeme = "6"
	if _, err = BuildPlan(got); err == nil {
		t.Fatal("accepted quote after amount change")
	}
}
