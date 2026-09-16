package demandevents

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type creatorTestSource struct {
	demandTestSource
	calls int
}

func (s *creatorTestSource) CallAt(context.Context, string, string, string) ([]byte, error) {
	s.calls++
	raw := make([]byte, 32)
	for i := 12; i < 32; i++ {
		raw[i] = 0x33
	}
	return raw, nil
}
func TestCreatorDirectoryUsesOriginalCreatorAndCachesIdentity(t *testing.T) {
	pool, cleanup := demandTestDB(t)
	defer cleanup()
	ctx := context.Background()
	scope := queueFixture(t, pool, "creator-test", 0)
	factory := "0x" + strings.Repeat("1", 40)
	scope.Modules = map[string]string{factory: "TickerGardenFactoryV1"}
	_, err := pool.Exec(ctx, `UPDATE tickergarden.demand_event_scopes SET read_through=10,processed_through=10 WHERE scope_id=$1`, scope.ID)
	if err != nil {
		t.Fatal(err)
	}
	id := "0x" + strings.Repeat("a", 64)
	hash := "0x" + strings.Repeat("b", 64)
	token := "0x" + strings.Repeat("2", 40)
	payload, _ := json.Marshal(map[string]any{"event": map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]string{"marketId": id, "memeToken": token}}})
	_, err = pool.Exec(ctx, `INSERT INTO tickergarden.demand_event_records(scope_id,block_number,transaction_index,log_index,block_hash,payload) VALUES($1,3,0,0,$2,$3)`, scope.ID, hash, payload)
	if err != nil {
		t.Fatal(err)
	}
	source := &creatorTestSource{}
	s := &Service{Pool: pool, Source: source, Default: scope}
	owner := "0x" + strings.Repeat("3", 40)
	own, err := s.CreatorMarkets(ctx, owner, "", 100)
	if err != nil || len(own.Items) != 1 || own.Items[0].MarketID != id || !own.Complete {
		t.Fatalf("own: %+v %v", own, err)
	}
	other, err := s.CreatorMarkets(ctx, "0x"+strings.Repeat("4", 40), "", 100)
	if err != nil || len(other.Items) != 0 {
		t.Fatalf("other: %+v %v", other, err)
	}
	if source.calls != 1 || source.logs.Load() != 0 {
		t.Fatalf("repeated RPC or history scan: %d", source.calls)
	}
	_, err = pool.Exec(ctx, `DELETE FROM tickergarden.demand_event_records WHERE scope_id=$1`, scope.ID)
	if err != nil {
		t.Fatal(err)
	}
	own, err = s.CreatorMarkets(ctx, owner, "", 100)
	if err != nil || len(own.Items) != 0 {
		t.Fatalf("orphaned record remained visible: %+v %v", own, err)
	}
}
