package demandevents

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

var stakingHistoryAddress = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var stakingHistoryMarket = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

// StakerRewardHistoryHandler returns actual payouts at the position's observation
// block. It never substitutes protocol fee allocations for a user's earnings.
func (s *Service) StakerRewardHistoryHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		market, account := strings.ToLower(r.URL.Query().Get("marketId")), strings.ToLower(r.URL.Query().Get("account"))
		block, err := strconv.ParseUint(r.URL.Query().Get("throughBlock"), 10, 63)
		if !stakingHistoryMarket.MatchString(market) || !stakingHistoryAddress.MatchString(account) || err != nil || block == 0 {
			http.Error(w, "Invalid history request", 400)
			return
		}
		factory, vault := "", ""
		for a, m := range s.Default.Modules {
			if m == "TickerGardenFactoryV1" {
				factory = a
			}
			if m == "ProtocolFeeVault" {
				vault = a
			}
		}
		// Existing on-demand range reader advances in the background; no RPC loop here.
		if _, err = s.Load(r.Context(), 1); err != nil {
			http.Error(w, "History unavailable", 503)
			return
		}
		var start, processed uint64
		var creation *uint64
		err = s.Pool.QueryRow(r.Context(), `SELECT d.start_block,d.processed_through,(SELECT min(e.block_number) FROM tickergarden.demand_event_records e WHERE e.scope_id=d.scope_id AND e.block_number<=d.processed_through AND e.payload->'event'->>'emitter'=$2 AND e.payload->'event'->>'signature'='MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)' AND e.payload->'event'->'args'->>'marketId'=$3) FROM tickergarden.demand_event_scopes d WHERE d.scope_id=$1`, s.Default.ID, factory, market).Scan(&start, &processed, &creation)
		if err != nil {
			http.Error(w, "History unavailable", 503)
			return
		}
		complete := creation != nil && start <= *creation && *creation <= block && processed >= block
		totals := map[string]string{}
		if complete {
			rows, e := s.Pool.Query(r.Context(), `SELECT lower(payload->'event'->'args'->>'feeAsset'),sum((payload->'event'->'args'->>'amount')::numeric)::text FROM tickergarden.demand_event_records WHERE scope_id=$1 AND block_number<=$2 AND payload->'event'->>'emitter'=$3 AND payload->'event'->>'signature'='FeeClaimed(uint8,address,bytes32,uint32,address,uint256)' AND payload->'event'->'args'->>'beneficiaryType'='1' AND lower(payload->'event'->'args'->>'beneficiary')=$4 AND payload->'event'->'args'->>'marketId'=$5 GROUP BY 1`, s.Default.ID, block, vault, account, market)
			if e != nil {
				http.Error(w, "History unavailable", 503)
				return
			}
			for rows.Next() {
				var asset, amount string
				if e = rows.Scan(&asset, &amount); e != nil {
					break
				}
				totals[asset] = amount
			}
			if e == nil {
				e = rows.Err()
			}
			rows.Close()
			if e != nil {
				http.Error(w, "History unavailable", 503)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]any{"chainId": s.Default.ChainID, "displayOnly": true, "marketId": market, "account": account, "throughBlock": strconv.FormatUint(block, 10), "complete": complete, "claimed": totals})
	})
}
