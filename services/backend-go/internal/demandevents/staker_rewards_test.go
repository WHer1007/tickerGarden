package demandevents

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStakerRewardHistoryInvalidParamsBeforeDB(t *testing.T) {
	h := (&Service{}).StakerRewardHistoryHandler()
	for _, query := range []string{"", "marketId=0x1&account=0x1&throughBlock=1", "marketId=0x" + strings.Repeat("a", 64) + "&account=0x" + strings.Repeat("b", 40) + "&throughBlock=0"} {
		r := httptest.NewRequest(http.MethodGet, "/history?"+query, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("query %q: status %d, want 400", query, w.Code)
		}
	}
}

func stakerHistoryService(t *testing.T, id string) (*Service, context.Context, func()) {
	t.Helper()
	p, cleanup := demandTestDB(t)
	scope := queueFixture(t, p, id, 0)
	factory := "0x" + strings.Repeat("1", 40)
	vault := "0x" + strings.Repeat("2", 40)
	scope.Modules = map[string]string{factory: "TickerGardenFactoryV1", vault: "ProtocolFeeVault"}
	ctx := context.Background()
	raw, err := json.Marshal(scope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.Exec(ctx, `UPDATE tickergarden.demand_event_scopes SET config=$2,read_through=20,processed_through=20 WHERE scope_id=$1`, id, raw); err != nil {
		cleanup()
		t.Fatal(err)
	}
	s := &Service{Pool: p, Source: &demandTestSource{}, Default: scope, ctx: ctx, fetching: map[string]bool{id: true}, slots: make(chan struct{}, 1), wake: make(chan struct{}, 1)}
	return s, ctx, cleanup
}

func insertStakerHistoryRecord(t *testing.T, s *Service, block uint64, payload map[string]any) {
	t.Helper()
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.demand_event_records(scope_id,block_number,transaction_index,log_index,block_hash,payload) VALUES($1,$2,0,$2,$3,$4)`, s.Default.ID, block, "0x"+strings.Repeat("a", 64), b)
	if err != nil {
		t.Fatal(err)
	}
}

func TestStakerRewardHistoryCompleteFiltersPayouts(t *testing.T) {
	s, ctx, cleanup := stakerHistoryService(t, "staker-history-filters")
	defer cleanup()
	market := "0x" + strings.Repeat("a", 64)
	account := "0x" + strings.Repeat("b", 40)
	factory := "0x" + strings.Repeat("1", 40)
	vault := "0x" + strings.Repeat("2", 40)
	insertStakerHistoryRecord(t, s, 3, map[string]any{"event": map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market}}})
	fee := func(emitter, beneficiary, marketID, asset, amount, typ string) map[string]any {
		return map[string]any{"event": map[string]any{"emitter": emitter, "signature": "FeeClaimed(uint8,address,bytes32,uint32,address,uint256)", "args": map[string]any{"feeAsset": asset, "amount": amount, "beneficiaryType": typ, "beneficiary": beneficiary, "marketId": marketID}}}
	}
	insertStakerHistoryRecord(t, s, 4, fee(vault, account, market, "0x"+strings.Repeat("c", 40), "7", "1"))
	insertStakerHistoryRecord(t, s, 5, fee(vault, account, market, "0x"+strings.Repeat("c", 40), "3", "1"))
	insertStakerHistoryRecord(t, s, 6, fee(vault, account, market, "0x"+strings.Repeat("d", 40), "11", "1"))
	insertStakerHistoryRecord(t, s, 7, fee(vault, "0x"+strings.Repeat("e", 40), market, "0x"+strings.Repeat("c", 40), "100", "1"))
	insertStakerHistoryRecord(t, s, 8, fee(vault, account, "0x"+strings.Repeat("f", 64), "0x"+strings.Repeat("c", 40), "100", "1"))
	insertStakerHistoryRecord(t, s, 9, fee(factory, account, market, "0x"+strings.Repeat("c", 40), "100", "1"))
	insertStakerHistoryRecord(t, s, 10, fee(vault, account, market, "0x"+strings.Repeat("c", 40), "100", "0"))
	insertStakerHistoryRecord(t, s, 11, fee(vault, account, market, "0x"+strings.Repeat("c", 40), "100", "1"))
	r := httptest.NewRequest(http.MethodGet, "/history?marketId="+market+"&account="+account+"&throughBlock=10", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	s.StakerRewardHistoryHandler().ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		Complete bool
		Claimed  map[string]string
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	asset := "0x" + strings.Repeat("c", 40)
	if !got.Complete || got.Claimed[asset] != "10" || got.Claimed["0x"+strings.Repeat("d", 40)] != "11" || len(got.Claimed) != 2 {
		t.Fatalf("response %+v", got)
	}
}

func TestStakerRewardHistoryIncompleteWithholdsPayouts(t *testing.T) {
	s, ctx, cleanup := stakerHistoryService(t, "staker-history-incomplete")
	defer cleanup()
	market := "0x" + strings.Repeat("a", 64)
	account := "0x" + strings.Repeat("b", 40)
	factory := "0x" + strings.Repeat("1", 40)
	vault := "0x" + strings.Repeat("2", 40)
	insertStakerHistoryRecord(t, s, 3, map[string]any{"event": map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market}}})
	insertStakerHistoryRecord(t, s, 4, map[string]any{"event": map[string]any{"emitter": vault, "signature": "FeeClaimed(uint8,address,bytes32,uint32,address,uint256)", "args": map[string]any{"feeAsset": "0x" + strings.Repeat("c", 40), "amount": "7", "beneficiaryType": "1", "beneficiary": account, "marketId": market}}})
	if _, err := s.Pool.Exec(ctx, `UPDATE tickergarden.demand_event_scopes SET processed_through=5 WHERE scope_id=$1`, s.Default.ID); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/history?marketId="+market+"&account="+account+"&throughBlock=6", nil)
	w := httptest.NewRecorder()
	s.StakerRewardHistoryHandler().ServeHTTP(w, r)
	var got struct {
		Complete bool
		Claimed  map[string]string
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || got.Complete || len(got.Claimed) != 0 {
		t.Fatalf("status=%d response=%s parsed=%+v", w.Code, w.Body.String(), got)
	}
}

func TestStakerRewardHistoryCompleteZeroPayouts(t *testing.T) {
	s, ctx, cleanup := stakerHistoryService(t, "staker-history-zero")
	defer cleanup()
	market := "0x" + strings.Repeat("a", 64)
	account := "0x" + strings.Repeat("b", 40)
	factory := "0x" + strings.Repeat("1", 40)
	insertStakerHistoryRecord(t, s, 3, map[string]any{"event": map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market}}})
	r := httptest.NewRequest(http.MethodGet, "/history?marketId="+market+"&account="+account+"&throughBlock=6", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	s.StakerRewardHistoryHandler().ServeHTTP(w, r)
	var got struct {
		Complete bool
		Claimed  map[string]string
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || !got.Complete || len(got.Claimed) != 0 {
		t.Fatalf("status=%d response=%s parsed=%+v", w.Code, w.Body.String(), got)
	}
}
