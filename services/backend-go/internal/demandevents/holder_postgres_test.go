package demandevents

import (
	"context"
	"encoding/json"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"strings"
	"testing"
)

type holderTestSource struct {
	demandTestSource
	calls int
}

func (s *holderTestSource) CallAt(context.Context, string, string, string) ([]byte, error) {
	s.calls++
	typ, _ := abi.NewType("string", "", nil)
	return (abi.Arguments{{Type: typ}}).Pack("BLOOM")
}
func TestHolderDirectoryFiltersRegistrationAndCachesSearch(t *testing.T) {
	pool, cleanup := demandTestDB(t)
	defer cleanup()
	ctx := context.Background()
	scope := queueFixture(t, pool, "holder-test", 0)
	distributor := "0x" + strings.Repeat("1", 40)
	scope.Modules = map[string]string{distributor: "HolderRewardsDistributorV1"}
	_, err := pool.Exec(ctx, `UPDATE tickergarden.demand_event_scopes SET processed_through=10,read_through=10 WHERE scope_id=$1`, scope.ID)
	if err != nil {
		t.Fatal(err)
	}
	id := "0x" + strings.Repeat("a", 64)
	token := "0x" + strings.Repeat("2", 40)
	hash := "0x" + strings.Repeat("b", 64)
	payload, _ := json.Marshal(map[string]any{"event": map[string]any{"emitter": distributor, "signature": "HolderStreamMarketRegistered(bytes32,address,address,address)", "args": map[string]string{"marketId": id, "token": token}}})
	_, err = pool.Exec(ctx, `INSERT INTO tickergarden.demand_event_records(scope_id,block_number,transaction_index,log_index,block_hash,payload) VALUES($1,3,0,0,$2,$3)`, scope.ID, hash, payload)
	if err != nil {
		t.Fatal(err)
	}
	source := &holderTestSource{}
	s := &Service{Pool: pool, Source: source, Default: scope}
	for _, q := range []string{"bloom", token, ""} {
		r, e := s.HolderMarkets(ctx, q)
		if e != nil || len(r.Items) != 1 || !r.Complete {
			t.Fatalf("%s %+v %v", q, r, e)
		}
	}
	r, e := s.HolderMarkets(ctx, "unmatched")
	if e != nil || len(r.Items) != 0 {
		t.Fatalf("unmatched %+v %v", r, e)
	}
	if source.calls != 2 || source.logs.Load() != 0 {
		t.Fatalf("repeated reads: %d", source.calls)
	}
	_, err = pool.Exec(ctx, `DELETE FROM tickergarden.demand_event_records WHERE scope_id=$1`, scope.ID)
	if err != nil {
		t.Fatal(err)
	}
	r, e = s.HolderMarkets(ctx, "")
	if e != nil || len(r.Items) != 0 {
		t.Fatalf("orphan: %+v %v", r, e)
	}
}
