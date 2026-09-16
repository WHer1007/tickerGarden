package demandevents

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func holderHistoryService(t *testing.T, id string) (*Service, string, string, string, func()) {
	t.Helper()
	s, ctx, cleanup := stakerHistoryService(t, id)
	factory := "0x" + strings.Repeat("1", 40)
	vault := "0x" + strings.Repeat("2", 40)
	s.Default.Modules[vault] = "HolderRewardsDistributorV1"
	// stakerHistoryService already persisted the module map; update it for the
	// handler's runtime lookup and use the same scope fixture.
	raw, err := json.Marshal(s.Default)
	if err != nil {
		cleanup()
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE tickergarden.demand_event_scopes SET config=$2 WHERE scope_id=$1`, id, raw); err != nil {
		cleanup()
		t.Fatal(err)
	}
	return s, factory, vault, "0x" + strings.Repeat("a", 64), cleanup
}

func holderClaim(market, account, asset, amount string, emitter string) map[string]any {
	return map[string]any{"event": map[string]any{
		"emitter": emitter, "signature": "HolderStreamClaimed(bytes32,address,address,uint256)",
		"args": map[string]any{"marketId": market, "account": account, "asset": asset, "amount": amount},
	}}
}

func TestHolderRewardHistoryCompleteFiltersPayouts(t *testing.T) {
	s, factory, vault, market, cleanup := holderHistoryService(t, "holder-history-filters")
	defer cleanup()
	account := "0x" + strings.Repeat("b", 40)
	asset := "0x" + strings.Repeat("c", 40)
	otherAsset := "0x" + strings.Repeat("d", 40)
	insertStakerHistoryRecord(t, s, 3, map[string]any{"event": map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market}}})
	insertStakerHistoryRecord(t, s, 4, holderClaim(market, account, asset, "7", vault))
	insertStakerHistoryRecord(t, s, 5, holderClaim(market, account, asset, "3", vault))
	insertStakerHistoryRecord(t, s, 6, holderClaim(market, account, otherAsset, "11", vault))
	insertStakerHistoryRecord(t, s, 7, holderClaim(market, "0x"+strings.Repeat("e", 40), asset, "100", vault))
	insertStakerHistoryRecord(t, s, 8, holderClaim("0x"+strings.Repeat("f", 64), account, asset, "100", vault))
	insertStakerHistoryRecord(t, s, 9, holderClaim(market, account, asset, "100", factory))
	insertStakerHistoryRecord(t, s, 11, holderClaim(market, account, asset, "100", vault))
	r := httptest.NewRequest(http.MethodGet, "/history?marketId="+market+"&account="+account+"&throughBlock=10", nil)
	w := httptest.NewRecorder()
	s.HolderRewardHistoryHandler().ServeHTTP(w, r)
	var got struct {
		Complete bool
		Claimed  map[string]string
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || !got.Complete || got.Claimed[asset] != "10" || got.Claimed[otherAsset] != "11" || len(got.Claimed) != 2 {
		t.Fatalf("status=%d response=%s parsed=%+v", w.Code, w.Body.String(), got)
	}
}

func TestHolderRewardHistoryIncompleteWithholdsPayouts(t *testing.T) {
	s, factory, vault, market, cleanup := holderHistoryService(t, "holder-history-incomplete")
	defer cleanup()
	account := "0x" + strings.Repeat("b", 40)
	asset := "0x" + strings.Repeat("c", 40)
	insertStakerHistoryRecord(t, s, 3, map[string]any{"event": map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market}}})
	insertStakerHistoryRecord(t, s, 4, holderClaim(market, account, asset, "7", vault))
	if _, err := s.Pool.Exec(s.ctx, `UPDATE tickergarden.demand_event_scopes SET processed_through=5 WHERE scope_id=$1`, s.Default.ID); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/history?marketId="+market+"&account="+account+"&throughBlock=6", nil)
	w := httptest.NewRecorder()
	s.HolderRewardHistoryHandler().ServeHTTP(w, r)
	var got struct {
		Complete bool
		Claimed  map[string]string
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || got.Complete || len(got.Claimed) != 0 {
		t.Fatalf("status=%d response=%s parsed=%+v", w.Code, w.Body.String(), got)
	}
}

func TestHolderRewardHistoryCompleteZeroPayouts(t *testing.T) {
	s, factory, _, market, cleanup := holderHistoryService(t, "holder-history-zero")
	defer cleanup()
	account := "0x" + strings.Repeat("b", 40)
	insertStakerHistoryRecord(t, s, 3, map[string]any{"event": map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market}}})
	r := httptest.NewRequest(http.MethodGet, "/history?marketId="+market+"&account="+account+"&throughBlock=6", nil)
	w := httptest.NewRecorder()
	s.HolderRewardHistoryHandler().ServeHTTP(w, r)
	var got struct {
		Complete bool
		Claimed  map[string]string
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || !got.Complete || len(got.Claimed) != 0 {
		t.Fatalf("status=%d response=%s parsed=%+v", w.Code, w.Body.String(), got)
	}
}

func TestDualHolderHistoryCountsActualPayoutNotConsumedOrRetainedMeme(t *testing.T) {
	s, factory, distributor, market, cleanup := holderHistoryService(t, "holder-dual-actual-payout")
	defer cleanup()
	feeVault := "0x" + strings.Repeat("7", 40)
	account := "0x" + strings.Repeat("b", 40)
	quote := "0x" + strings.Repeat("c", 40)
	meme := "0x" + strings.Repeat("d", 40)
	s.Default.Modules[feeVault] = "ProtocolFeeVault"
	raw, _ := json.Marshal(s.Default)
	if _, err := s.Pool.Exec(s.ctx, `UPDATE tickergarden.demand_event_scopes SET config=$2 WHERE scope_id=$1`, s.Default.ID, raw); err != nil {
		t.Fatal(err)
	}
	insertStakerHistoryRecord(t, s, 3, map[string]any{"event": map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market}}})
	insertStakerHistoryRecord(t, s, 4, map[string]any{"event": map[string]any{"emitter": distributor, "signature": "HolderStreamMarketRegistered(bytes32,address,address,address)", "args": map[string]any{"marketId": market, "token": meme, "quote": quote, "vault": feeVault}}})
	tx := "0x" + strings.Repeat("a", 64)
	consumed := holderClaim(market, account, meme, "100", distributor)
	consumed["transactionHash"] = tx
	insertStakerHistoryRecord(t, s, 5, consumed)
	insertStakerHistoryRecord(t, s, 6, map[string]any{"transactionHash": tx, "event": map[string]any{"emitter": feeVault, "signature": "UserRewardsClaimed(bytes32,address,uint8,uint32,uint256,uint256,uint256,uint256,bool)", "args": map[string]any{"marketId": market, "user": account, "role": "2", "quotePaid": "12", "memePaid": "0", "memeRetained": "60", "memeConverted": "40", "conversionFailed": false}}})
	if _, err := s.Pool.Exec(s.ctx, `UPDATE tickergarden.demand_event_records SET block_number=5 WHERE scope_id=$1 AND log_index=6`, s.Default.ID); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	s.HolderRewardHistoryHandler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/history?marketId="+market+"&account="+account+"&throughBlock=10", nil))
	var got struct {
		Complete bool
		Claimed  map[string]string
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &got) != nil || !got.Complete || got.Claimed[quote] != "12" || got.Claimed[meme] != "0" {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
