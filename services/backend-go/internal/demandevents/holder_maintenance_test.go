package demandevents

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func insertMaintenanceEvent(t *testing.T, s *Service, block uint64, event map[string]any) {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"event": event})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.demand_event_records(scope_id,block_number,transaction_index,log_index,block_hash,payload) VALUES($1,$2,0,$2,$3,$4)`, s.Default.ID, block, "0x"+strings.Repeat("a", 64), payload)
	if err != nil {
		t.Fatal(err)
	}
}

func TestHolderMaintenanceUsesCurveEmitterForRevision(t *testing.T) {
	s, factory, distributor, market, cleanup := holderHistoryService(t, "holder-maintenance-revision")
	defer cleanup()
	s.Default.Modules[distributor] = "UserStockVault"
	raw, err := json.Marshal(s.Default)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(context.Background(), `UPDATE tickergarden.demand_event_scopes SET config=$2 WHERE scope_id=$1`, s.Default.ID, raw); err != nil {
		t.Fatal(err)
	}
	curve := "0x" + strings.Repeat("c", 40)
	token := "0x" + strings.Repeat("d", 40)
	otherMarket := "0x" + strings.Repeat("e", 64)
	insertMaintenanceEvent(t, s, 3, map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market, "curve": curve, "memeToken": token}})
	// The candidate is emitted for every canonical market, including a market without holder registration.
	insertMaintenanceEvent(t, s, 4, map[string]any{"emitter": distributor, "signature": "AllocationLocked(bytes32,address,uint256)", "args": map[string]any{"marketId": market, "user": "0x" + strings.Repeat("9", 40)}})
	// Curve events intentionally omit marketId; their curve emitter still advances this market.
	insertMaintenanceEvent(t, s, 7, map[string]any{"emitter": curve, "signature": "CurveBuy(bytes32,address,uint256,uint256)"})
	insertMaintenanceEvent(t, s, 9, map[string]any{"emitter": curve, "signature": "CurveSell(bytes32,address,uint256,uint256)"})
	// An unrelated market and emitter must not advance the registered market.
	insertMaintenanceEvent(t, s, 12, map[string]any{"emitter": "0x" + strings.Repeat("f", 40), "signature": "CurveBuy(bytes32,address,uint256,uint256)", "args": map[string]any{"marketId": otherMarket}})
	r := httptest.NewRequest(http.MethodGet, "/maintenance", nil)
	w := httptest.NewRecorder()
	s.HolderMaintenanceHandler().ServeHTTP(w, r)
	var got struct {
		Items []struct {
			MarketID string   `json:"marketId"`
			Token    string   `json:"token"`
			Revision string   `json:"revision"`
			Accounts []string `json:"accounts"`
		} `json:"items"`
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || len(got.Items) != 1 {
		t.Fatalf("status=%d response=%s", w.Code, w.Body.String())
	}
	if got.Items[0].MarketID != market || got.Items[0].Token != token || got.Items[0].Revision != "9" || len(got.Items[0].Accounts) != 1 || got.Items[0].Accounts[0] != "0x"+strings.Repeat("9", 40) {
		t.Fatalf("items=%+v", got.Items)
	}
}

func TestHolderMaintenanceEmptyWhenNoRegisteredHolder(t *testing.T) {
	s, _, _, _, cleanup := holderHistoryService(t, "holder-maintenance-empty")
	defer cleanup()
	r := httptest.NewRequest(http.MethodGet, "/maintenance", nil)
	w := httptest.NewRecorder()
	s.HolderMaintenanceHandler().ServeHTTP(w, r)
	var got struct {
		Items []map[string]string `json:"items"`
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || len(got.Items) != 0 {
		t.Fatalf("status=%d response=%s", w.Code, w.Body.String())
	}
}
