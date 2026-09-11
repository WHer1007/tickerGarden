package demandevents

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLaunchRecoveryCanonicalProcessedFactoryOnly(t *testing.T) {
	s, factory, _, market, cleanup := holderHistoryService(t, "recovery-canonical")
	defer cleanup()
	tx := "0x" + strings.Repeat("b", 64)
	insertStakerHistoryRecord(t, s, 3, map[string]any{"transactionHash": tx, "event": map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market}}})
	insertStakerHistoryRecord(t, s, 4, map[string]any{"transactionHash": "0x" + strings.Repeat("d", 64), "event": map[string]any{"emitter": "0x" + strings.Repeat("e", 40), "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market}}})
	if _, err := s.Pool.Exec(context.Background(), `UPDATE tickergarden.demand_event_scopes SET processed_through=3 WHERE scope_id=$1`, s.Default.ID); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/recovery?marketId="+market, nil)
	w := httptest.NewRecorder()
	s.LaunchRecoveryHandler().ServeHTTP(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), tx) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	bad := httptest.NewRequest(http.MethodGet, "/recovery?marketId=bad", nil)
	bw := httptest.NewRecorder()
	s.LaunchRecoveryHandler().ServeHTTP(bw, bad)
	if bw.Code != http.StatusBadRequest {
		t.Fatalf("invalid id status=%d", bw.Code)
	}
}

func TestWalletHolderHistoryIncludesTransferredOutMarket(t *testing.T) {
	s, _, vault, market, cleanup := holderHistoryService(t, "wallet-holder-history")
	defer cleanup()
	account := "0x" + strings.Repeat("a", 40)
	token := "0x" + strings.Repeat("b", 40)
	other := "0x" + strings.Repeat("c", 64)
	blockHash := "0x" + strings.Repeat("d", 64)
	if _, err := s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.holder_market_directory(scope_id,market_id,meme_token,name,symbol,registration_block_hash) VALUES($1,$2,$3,$4,$5,$6)`, s.Default.ID, market, token, "Garden", "GRDN", blockHash); err != nil {
		t.Fatal(err)
	}
	reg := map[string]any{"event": map[string]any{"emitter": vault, "signature": "HolderStreamMarketRegistered(bytes32,address,address,address)", "args": map[string]any{"marketId": market}}}
	regRaw, _ := json.Marshal(reg)
	if _, err := s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.demand_event_records(scope_id,block_number,transaction_index,log_index,block_hash,payload) VALUES($1,3,0,0,$2,$3)`, s.Default.ID, blockHash, regRaw); err != nil {
		t.Fatal(err)
	}
	transfer := map[string]any{"event": map[string]any{"emitter": token, "signature": "Transfer(address,address,uint256)", "args": map[string]any{"to": account}}}
	insertStakerHistoryRecord(t, s, 4, transfer)
	otherTransfer := map[string]any{"event": map[string]any{"emitter": "0x" + strings.Repeat("e", 40), "signature": "Transfer(address,address,uint256)", "args": map[string]any{"to": account}}}
	insertStakerHistoryRecord(t, s, 5, otherTransfer)
	r := httptest.NewRequest(http.MethodGet, "/holders?account="+account, nil)
	w := httptest.NewRecorder()
	s.WalletHolderHandler().ServeHTTP(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), market) || strings.Contains(w.Body.String(), other) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	bad := httptest.NewRequest(http.MethodGet, "/holders?account=bad", nil)
	bw := httptest.NewRecorder()
	s.WalletHolderHandler().ServeHTTP(bw, bad)
	if bw.Code != http.StatusBadRequest {
		t.Fatalf("invalid wallet status=%d", bw.Code)
	}
}

func TestWalletHolderHistoryUsesTransferLedgerWithoutChildTransferEvent(t *testing.T) {
	s, _, _, market, cleanup := holderHistoryService(t, "wallet-holder-transfer-ledger")
	defer cleanup()
	registry := "0x" + strings.Repeat("3", 40)
	account := "0x" + strings.Repeat("a", 40)
	token := "0x" + strings.Repeat("b", 40)
	blockHash := "0x" + strings.Repeat("d", 64)
	s.Default.Modules[registry] = "MarketRegistryV1"
	raw, err := json.Marshal(s.Default)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(context.Background(), `UPDATE tickergarden.demand_event_scopes SET chain_id=46630,config=$2 WHERE scope_id=$1`, s.Default.ID, raw); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.holder_market_directory(scope_id,market_id,meme_token,name,symbol,registration_block_hash) VALUES($1,$2,$3,$4,$5,$6)`, s.Default.ID, market, token, "Garden", "GRDN", blockHash); err != nil {
		t.Fatal(err)
	}
	reg := map[string]any{"event": map[string]any{"emitter": s.Default.Modules["0x"+strings.Repeat("2", 40)], "signature": "HolderStreamMarketRegistered(bytes32,address,address,address)", "args": map[string]any{"marketId": market}}}
	// The fixture's vault is the registered module; recover it from the persisted module map.
	for address, module := range s.Default.Modules {
		if module == "HolderRewardsDistributorV1" {
			reg["event"].(map[string]any)["emitter"] = address
		}
	}
	regRaw, _ := json.Marshal(reg)
	if _, err := s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.demand_event_records(scope_id,block_number,transaction_index,log_index,block_hash,payload) VALUES($1,3,0,0,$2,$3)`, s.Default.ID, blockHash, regRaw); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.market_transfer_events(chain_id,registry,market_id,block_number,transaction_hash,log_index,from_address,to_address) VALUES(46630,$1,$2,4,$3,0,$4,$5)`, registry, market, "0x"+strings.Repeat("e", 64), "0x"+strings.Repeat("f", 40), account); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/holders?account="+account, nil)
	w := httptest.NewRecorder()
	s.WalletHolderHandler().ServeHTTP(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), market) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
