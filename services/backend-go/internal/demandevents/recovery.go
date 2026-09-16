package demandevents

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

var walletAddress = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

// Recovery returns public canonical-event hints, never a replacement launch intent.
func (s *Service) LaunchRecoveryHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		id := strings.ToLower(r.URL.Query().Get("marketId"))
		if !displayMarketID.MatchString(id) {
			http.Error(w, "Invalid market", 400)
			return
		}
		factory := ""
		for a, m := range s.Default.Modules {
			if m == "TickerGardenFactoryV1" {
				factory = a
			}
		}
		var hash string
		err := s.Pool.QueryRow(r.Context(), `SELECT e.payload->>'transactionHash' FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes d USING(scope_id) WHERE e.scope_id=$1 AND e.block_number<=d.processed_through AND e.payload->'event'->>'emitter'=$2 AND e.payload->'event'->>'signature' LIKE 'MarketCreated(%' AND e.payload->'event'->'args'->>'marketId'=$3 LIMIT 1`, s.Default.ID, factory, id).Scan(&hash)
		if err != nil {
			http.Error(w, "Launch not indexed", 404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]any{"chainId": s.Default.ChainID, "displayOnly": true, "marketId": id, "transactionHash": hash})
	})
}

// Includes sold positions: a historic incoming transfer may still have vested
// rewards. The API selects candidates only; the distributor determines claims.
func (s *Service) WalletHolderHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		account := strings.ToLower(r.URL.Query().Get("account"))
		if !walletAddress.MatchString(account) {
			http.Error(w, "Invalid account", 400)
			return
		}
		// Warm only missing immutable identities; existing entries require no RPC.
		if _, err := s.HolderMarkets(r.Context(), ""); err != nil {
			http.Error(w, "Rewards unavailable", 503)
			return
		}
		registry := ""
		for a, m := range s.Default.Modules {
			if m == "MarketRegistryV1" {
				registry = a
			}
		}
		rows, err := s.Pool.Query(r.Context(), `SELECT DISTINCT d.market_id,d.meme_token,d.name,d.symbol FROM tickergarden.holder_market_directory d JOIN tickergarden.demand_event_scopes s USING(scope_id) WHERE d.scope_id=$1 AND (
 EXISTS(SELECT 1 FROM tickergarden.demand_event_records e WHERE e.scope_id=d.scope_id AND e.block_number<=s.processed_through AND e.payload->'event'->>'emitter'=d.meme_token AND e.payload->'event'->>'signature'='Transfer(address,address,uint256)' AND e.payload->'event'->'args'->>'to'=$2)
 OR EXISTS(SELECT 1 FROM tickergarden.market_transfer_events t WHERE t.chain_id=s.chain_id AND t.registry=$3 AND t.market_id=d.market_id AND t.to_address=$2))
 AND EXISTS(SELECT 1 FROM tickergarden.demand_event_records registered WHERE registered.scope_id=d.scope_id AND registered.block_hash=d.registration_block_hash AND registered.block_number<=s.processed_through AND registered.payload->'event'->'args'->>'marketId'=d.market_id) ORDER BY d.market_id LIMIT 101`, s.Default.ID, account, registry)
		if err != nil {
			http.Error(w, "Rewards unavailable", 503)
			return
		}
		defer rows.Close()
		type item struct {
			MarketID  string `json:"marketId"`
			MemeToken string `json:"memeToken"`
			Name      string `json:"name"`
			Symbol    string `json:"symbol"`
		}
		items := []item{}
		for rows.Next() {
			var v item
			if rows.Scan(&v.MarketID, &v.MemeToken, &v.Name, &v.Symbol) != nil {
				http.Error(w, "Rewards unavailable", 503)
				return
			}
			items = append(items, v)
		}
		if rows.Err() != nil {
			http.Error(w, "Rewards unavailable", 503)
			return
		}
		complete := len(items) <= 100
		if !complete {
			items = items[:100]
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]any{"chainId": s.Default.ChainID, "displayOnly": true, "account": account, "complete": complete, "items": items})
	})
}
