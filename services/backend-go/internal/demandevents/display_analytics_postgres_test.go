package demandevents

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMarketDisplayPreservesRecipientsVolumeAndScope(t *testing.T) {
	s, factory, vault, market, cleanup := holderHistoryService(t, "display-analytics")
	defer cleanup()
	registry := "0x" + strings.Repeat("3", 40)
	quote := "0x" + strings.Repeat("4", 40)
	curve := "0x" + strings.Repeat("5", 40)
	s.Default.Modules[registry] = "MarketRegistryV1"
	s.Default.Modules[vault] = "ProtocolFeeVault"
	s.Default.ChainID = 46630
	raw, err := json.Marshal(s.Default)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(context.Background(), `UPDATE tickergarden.demand_event_scopes SET config=$2 WHERE scope_id=$1`, s.Default.ID, raw); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(context.Background(), `UPDATE tickergarden.demand_event_scopes SET chain_id=46630 WHERE scope_id=$1`, s.Default.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(context.Background(), `UPDATE tickergarden.demand_event_scopes SET observed_at=clock_timestamp() WHERE scope_id=$1`, s.Default.ID); err != nil {
		t.Fatal(err)
	}
	created := map[string]any{"event": map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market, "quoteAsset": quote, "curve": curve}}}
	insertStakerHistoryRecord(t, s, 3, created)
	insertStakerHistoryRecord(t, s, 4, map[string]any{"event": map[string]any{"emitter": vault, "signature": "FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)", "args": map[string]any{"marketId": market, "feeAsset": quote, "creatorAmount": "7", "stakerAmount": "3", "platformAmount": "2"}}})
	insertStakerHistoryRecord(t, s, 5, map[string]any{"event": map[string]any{"emitter": vault, "signature": "HolderFeesAccrued(bytes32,uint32,address,uint256)", "args": map[string]any{"marketId": market, "feeAsset": quote, "amount": "4"}}})
	state, _ := json.Marshal(map[string]any{"volumeVersion": 2, "volumeRaw": "123", "volumeAt": time.Now().Unix()})
	if _, err = s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.market_statistics(chain_id,registry,market_id,state) VALUES($1,$2,$3,$4)`, s.Default.ChainID, registry, market, state); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/v1/market-display-statistics?marketId="+market, nil)
	w := httptest.NewRecorder()
	s.MarketDisplayHandler().ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var got struct {
		FeeCoverage     bool    `json:"feeCoverage"`
		VolumeRaw       *string `json:"volumeRaw"`
		FeeDistribution []struct {
			Recipient string `json:"recipient"`
			Asset     string `json:"asset"`
			AmountRaw string `json:"amountRaw"`
		} `json:"feeDistribution"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.FeeCoverage || got.VolumeRaw == nil || *got.VolumeRaw != "123" {
		t.Fatalf("response=%s", w.Body.String())
	}
	seen := map[string]string{}
	for _, row := range got.FeeDistribution {
		seen[row.Recipient] = row.AmountRaw
	}
	if seen["creator"] != "7" || seen["stakers"] != "3" || seen["platform"] != "2" || seen["holders"] != "4" {
		t.Fatalf("distribution=%v", seen)
	}
}

func insertTradingEvent(t *testing.T, s *Service, block uint64, tx, hash string, event map[string]any) {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"event": event, "transactionHash": tx})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.demand_event_records(scope_id,block_number,transaction_index,log_index,block_hash,payload) VALUES($1,$2,0,$2,$3,$4)`, s.Default.ID, block, hash, payload); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.display_block_times(chain_id,block_hash,block_number,block_time) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, s.Default.ChainID, hash, block, time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
}

func TestTradingFeesUsesExecutionTimeAndPairsHolderCredit(t *testing.T) {
	s, factory, vault, market, cleanup := holderHistoryService(t, "trading-fees-history")
	defer cleanup()
	s.Default.Modules[vault] = "ProtocolFeeVault"
	quote := "0x" + strings.Repeat("4", 40)
	curve := "0x" + strings.Repeat("5", 40)
	raw, err := json.Marshal(s.Default)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(context.Background(), `UPDATE tickergarden.demand_event_scopes SET config=$2,read_through=30,processed_through=30 WHERE scope_id=$1`, s.Default.ID, raw); err != nil {
		t.Fatal(err)
	}
	insertTradingEvent(t, s, 2, "0x"+strings.Repeat("1", 64), "0x"+strings.Repeat("2", 64), map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market, "curve": curve, "quoteAsset": quote}})
	// Old curve execution is outside cutoff; its delayed sweep must not count.
	insertTradingEvent(t, s, 3, "0x"+strings.Repeat("3", 64), "0x"+strings.Repeat("4", 64), map[string]any{"emitter": curve, "signature": "CurveBuy(address,address,uint256,uint256,uint256,uint256)", "args": map[string]any{"marketId": market, "fee": "7", "tax": "3"}})
	if _, err = s.Pool.Exec(context.Background(), `UPDATE tickergarden.display_block_times SET block_time=$1 WHERE chain_id=$2 AND block_number=3`, time.Now().Add(-2*time.Hour).Unix(), s.Default.ChainID); err != nil {
		t.Fatal(err)
	}
	insertTradingEvent(t, s, 20, "0x"+strings.Repeat("5", 64), "0x"+strings.Repeat("6", 64), map[string]any{"emitter": vault, "signature": "CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256,uint256)", "args": map[string]any{"marketId": market, "quoteAsset": quote}})
	// New curve executions count fee + tax, with sell using the same rule.
	insertTradingEvent(t, s, 21, "0x"+strings.Repeat("7", 64), "0x"+strings.Repeat("8", 64), map[string]any{"emitter": curve, "signature": "CurveBuy(address,address,uint256,uint256,uint256,uint256)", "args": map[string]any{"marketId": market, "fee": "4", "tax": "2"}})
	insertTradingEvent(t, s, 22, "0x"+strings.Repeat("9", 64), "0x"+strings.Repeat("a", 64), map[string]any{"emitter": curve, "signature": "CurveSell(address,address,uint256,uint256,uint256,uint256)", "args": map[string]any{"marketId": market, "fee": "5", "tax": "1"}})
	// A paired credited bucket and adjacent holder credit count once; an unpaired old holder credit is ignored.
	insertTradingEvent(t, s, 19, "0x"+strings.Repeat("5", 64), "0x"+strings.Repeat("b", 64), map[string]any{"emitter": vault, "signature": "HolderFeesAccrued(bytes32,uint32,address,uint256)", "args": map[string]any{"marketId": market, "feeAsset": quote, "amount": "99"}})
	insertTradingEvent(t, s, 24, "0x"+strings.Repeat("d", 64), "0x"+strings.Repeat("e", 64), map[string]any{"emitter": vault, "signature": "FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)", "args": map[string]any{"marketId": market, "feeAsset": quote, "creatorAmount": "10", "stakerAmount": "20", "platformAmount": "30"}})
	insertTradingEvent(t, s, 23, "0x"+strings.Repeat("d", 64), "0x"+strings.Repeat("f", 64), map[string]any{"emitter": vault, "signature": "HolderFeesAccrued(bytes32,uint32,address,uint256)", "args": map[string]any{"marketId": market, "feeAsset": quote, "amount": "40"}})
	totals, err := s.tradingFees(context.Background(), 30, uint64(time.Now().Unix()-3600), vault)
	if err != nil {
		t.Fatal(err)
	}
	if totals[quote] != "112" {
		t.Fatalf("totals=%v", totals)
	}
}

func TestTradingFeesUsesCurveLedgerWhenChildEventsAreAbsentAndDeduplicates(t *testing.T) {
	s, factory, vault, market, cleanup := holderHistoryService(t, "trading-fees-ledger")
	defer cleanup()
	registry := "0x" + strings.Repeat("3", 40)
	quote := "0x" + strings.Repeat("4", 40)
	s.Default.Modules[registry] = "MarketRegistryV1"
	s.Default.Modules[vault] = "ProtocolFeeVault"
	s.Default.ChainID = 46630
	raw, err := json.Marshal(s.Default)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(context.Background(), `UPDATE tickergarden.demand_event_scopes SET config=$2,chain_id=46630,read_through=30,processed_through=30 WHERE scope_id=$1`, s.Default.ID, raw); err != nil {
		t.Fatal(err)
	}
	insertTradingEvent(t, s, 2, "0x"+strings.Repeat("1", 64), "0x"+strings.Repeat("2", 64), map[string]any{"emitter": factory, "signature": "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", "args": map[string]any{"marketId": market, "curve": "0x" + strings.Repeat("5", 40), "quoteAsset": quote}})
	blockTime := time.Now().Unix()
	_, err = s.Pool.Exec(context.Background(), `INSERT INTO tickergarden.market_volume_events(chain_id,registry,market_id,block_number,block_hash,transaction_hash,log_index,block_time,amount,curve_fee) VALUES($1,$2,$3,10,$4,$5,0,$6,100,13),($1,$2,$3,11,$7,$8,11,$6,100,99)`, s.Default.ChainID, registry, market, "0x"+strings.Repeat("6", 64), "0x"+strings.Repeat("7", 64), blockTime, "0x"+strings.Repeat("8", 64), "0x"+strings.Repeat("9", 64))
	if err != nil {
		t.Fatal(err)
	}
	insertTradingEvent(t, s, 11, "0x"+strings.Repeat("9", 64), "0x"+strings.Repeat("8", 64), map[string]any{"emitter": "0x" + strings.Repeat("5", 40), "signature": "CurveBuy(address,address,uint256,uint256,uint256,uint256)", "args": map[string]any{"marketId": market, "fee": "4", "tax": "2"}})
	totals, err := s.tradingFees(context.Background(), 30, uint64(blockTime-60), vault)
	if err != nil {
		t.Fatal(err)
	}
	if totals[quote] != "19" {
		t.Fatalf("totals=%v", totals)
	}
}
