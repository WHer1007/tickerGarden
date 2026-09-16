package operations

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

type fakeRPCObserver struct {
	chain    uint64
	chainErr error
	headers  map[string]chainrpc.Header
	errors   map[string]error
}

func (f fakeRPCObserver) ChainID(context.Context) (uint64, error) { return f.chain, f.chainErr }
func (f fakeRPCObserver) Header(_ context.Context, name string) (chainrpc.Header, error) {
	if err := f.errors[name]; err != nil {
		return chainrpc.Header{}, err
	}
	h, ok := f.headers[name]
	if !ok {
		return chainrpc.Header{}, errors.New("missing header")
	}
	return h, nil
}

const (
	testGenesis = "0x0000000000000000000000000000000000000000000000000000000000000001"
	testHash2   = "0x0000000000000000000000000000000000000000000000000000000000000002"
	testHash10  = "0x0000000000000000000000000000000000000000000000000000000000000010"
)

func observedRPCStatus() Status {
	return Status{ChainID: 46630, GenesisHash: testGenesis, Stages: []Stage{{Name: "journal", Height: u64(8)}}}
}

func healthyRPC() fakeRPCObserver {
	return fakeRPCObserver{chain: 46630, headers: map[string]chainrpc.Header{
		"0x0":       {Number: "0x0", Hash: testGenesis},
		"latest":    {Number: "0xa", Hash: testHash10},
		"finalized": {Number: "0x2", Hash: testHash2},
		"0x2":       {Number: "0x2", Hash: testHash2},
		"0xa":       {Number: "0xa", Hash: testHash10},
	}}
}

func TestObserveRPCHealthyAndBoundedLag(t *testing.T) {
	s := observedRPCStatus()
	s.ProductionReadinessVerified = true
	stored := "2"
	s.StoredFinalized, s.StoredFinalizedHash = &stored, strptr(testHash2)
	got, err := ObserveRPC(context.Background(), s, healthyRPC(), 2)
	if err != nil {
		t.Fatal(err)
	}
	if got.ProductionReadinessVerified || got.RPC == nil || !got.RPC.IdentityVerified || got.RPC.LatestBlock != "10" || got.RPC.FinalizedBlock != "2" {
		t.Fatalf("rpc=%+v", got.RPC)
	}
	if got.RPC.JournalLagBlocks == nil || *got.RPC.JournalLagBlocks != "2" || got.RPC.FinalizedLagBlocks == nil || *got.RPC.FinalizedLagBlocks != "0" {
		t.Fatalf("lags=%+v", got.RPC)
	}
	if got.RPC.StoredFinalizedHashMatches == nil || !*got.RPC.StoredFinalizedHashMatches || got.State != "within_monitoring_thresholds" {
		t.Fatalf("status=%+v", got)
	}
}

func TestObserveRPCBacklogsJournalAndStoredFinalized(t *testing.T) {
	s := observedRPCStatus()
	stored := "0"
	s.StoredFinalized, s.StoredFinalizedHash = &stored, strptr("0x0000000000000000000000000000000000000000000000000000000000000001")
	r := healthyRPC()
	r.headers["0x0"] = chainrpc.Header{Number: "0x0", Hash: *s.StoredFinalizedHash}
	got, err := ObserveRPC(context.Background(), s, r, 1)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"rpc_journal_backlog", "rpc_finalized_backlog"}
	if !reflect.DeepEqual(got.Alerts, want) {
		t.Fatalf("alerts=%v want=%v", got.Alerts, want)
	}
}

func TestObserveRPCFinalityRegressionAndChangedAnchor(t *testing.T) {
	s := observedRPCStatus()
	stored := "3"
	s.StoredFinalized, s.StoredFinalizedHash = &stored, strptr(testHash2)
	got, err := ObserveRPC(context.Background(), s, healthyRPC(), 100)
	if err != nil || !reflect.DeepEqual(got.Alerts, []string{"rpc_finality_regression"}) {
		t.Fatalf("got=%+v err=%v", got, err)
	}
	stored = "2"
	s.StoredFinalizedHash = strptr(testHash10)
	got, err = ObserveRPC(context.Background(), s, healthyRPC(), 100)
	if err != nil || !reflect.DeepEqual(got.Alerts, []string{"rpc_finalized_anchor_changed"}) {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}

func TestObserveRPCRejectsIdentityOrderingAndPinnedChanges(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*Status, *fakeRPCObserver)
	}{
		{"wrong chain", func(_ *Status, r *fakeRPCObserver) { r.chain = 1 }},
		{"wrong genesis", func(_ *Status, r *fakeRPCObserver) { h := r.headers["0x0"]; h.Hash = testHash2; r.headers["0x0"] = h }},
		{"finalized beyond latest", func(_ *Status, r *fakeRPCObserver) {
			h := r.headers["finalized"]
			h.Number = "0xb"
			r.headers["finalized"] = h
		}},
		{"pinned hash changed", func(_ *Status, r *fakeRPCObserver) { h := r.headers["0xa"]; h.Hash = testHash2; r.headers["0xa"] = h }},
		{"pinned finalized changed", func(_ *Status, r *fakeRPCObserver) { h := r.headers["0x2"]; h.Hash = testHash10; r.headers["0x2"] = h }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := observedRPCStatus()
			r := healthyRPC()
			tc.mutate(&s, &r)
			got, err := ObserveRPC(context.Background(), s, r, 1)
			if err == nil || !reflect.DeepEqual(got, Status{}) {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
}

func TestObserveRPCRPCFailureReturnsZeroWithoutPartialStatus(t *testing.T) {
	s := observedRPCStatus()
	r := healthyRPC()
	r.errors = map[string]error{"latest": errors.New("offline")}
	got, err := ObserveRPC(context.Background(), s, r, 1)
	if err == nil || !reflect.DeepEqual(got, Status{}) {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}

func strptr(s string) *string { return &s }

func TestObserveRPCHeadBehindJournalDoesNotUnderflow(t *testing.T) {
	s := observedRPCStatus()
	s.Stages[0].Height = u64(11)
	got, err := ObserveRPC(context.Background(), s, healthyRPC(), 0)
	if err != nil || !reflect.DeepEqual(got.Alerts, []string{"rpc_head_behind_journal"}) || got.RPC.JournalLagBlocks != nil {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}
