package demandevents

import (
	"encoding/json"
	"net/http"
)

// Scheduling hints only. All beneficiaries, identities and amounts are checked
// on chain by the sender; this endpoint cannot authorize any transfer.
func (s *Service) HolderMaintenanceHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		if _, err := s.Load(r.Context(), 1); err != nil {
			http.Error(w, "Candidates unavailable", 503)
			return
		}
		factory, vault := "", ""
		for a, m := range s.Default.Modules {
			if m == "TickerGardenFactoryV1" {
				factory = a
			}
			if m == "UserStockVault" {
				vault = a
			}
		}
		rows, err := s.Pool.Query(r.Context(), `SELECT c.payload->'event'->'args'->>'marketId',c.payload->'event'->'args'->>'memeToken',COALESCE(max(e.block_number),c.block_number)::text
 FROM tickergarden.demand_event_records c JOIN tickergarden.demand_event_scopes s USING(scope_id)
 LEFT JOIN tickergarden.demand_event_records e ON e.scope_id=c.scope_id AND e.block_number<=s.processed_through
 AND (e.payload->'event'->'args'->>'marketId'=c.payload->'event'->'args'->>'marketId' OR e.payload->'event'->>'emitter'=c.payload->'event'->'args'->>'curve')
 AND (e.payload->'event'->>'signature' LIKE 'CurveBuy(%' OR e.payload->'event'->>'signature' LIKE 'CurveSell(%' OR e.payload->'event'->>'signature' LIKE 'FeeBucketsCredited(%' OR e.payload->'event'->>'signature' LIKE 'HolderFeesAccrued(%' OR e.payload->'event'->>'signature' LIKE 'AllocationLocked(%' OR e.payload->'event'->>'signature' LIKE 'AllocationReleased(%')
 WHERE c.scope_id=$1 AND c.block_number<=s.processed_through AND c.payload->'event'->>'emitter'=$2 AND c.payload->'event'->>'signature' LIKE 'MarketCreated(%'
 GROUP BY c.block_number,c.payload ORDER BY c.payload->'event'->'args'->>'marketId'`, s.Default.ID, factory)
		if err != nil {
			http.Error(w, "Candidates unavailable", 503)
			return
		}
		type item struct {
			MarketID string   `json:"marketId"`
			Token    string   `json:"token"`
			Revision string   `json:"revision"`
			Accounts []string `json:"accounts"`
		}
		items := []item{}
		for rows.Next() {
			var i item
			if rows.Scan(&i.MarketID, &i.Token, &i.Revision) != nil {
				rows.Close()
				http.Error(w, "Candidates unavailable", 503)
				return
			}
			i.Accounts = []string{}
			items = append(items, i)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			http.Error(w, "Candidates unavailable", 503)
			return
		}
		for n := range items {
			accounts, err := s.Pool.Query(r.Context(), `SELECT DISTINCT e.payload->'event'->'args'->>'user' FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes s USING(scope_id) WHERE e.scope_id=$1 AND e.block_number<=s.processed_through AND e.payload->'event'->>'emitter'=$2 AND e.payload->'event'->'args'->>'marketId'=$3 AND e.payload->'event'->'args'->>'user' IS NOT NULL`, s.Default.ID, vault, items[n].MarketID)
			if err != nil {
				http.Error(w, "Candidates unavailable", 503)
				return
			}
			for accounts.Next() {
				var account string
				if accounts.Scan(&account) != nil {
					accounts.Close()
					http.Error(w, "Candidates unavailable", 503)
					return
				}
				items[n].Accounts = append(items[n].Accounts, account)
			}
			err = accounts.Err()
			accounts.Close()
			if err != nil {
				http.Error(w, "Candidates unavailable", 503)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]any{"chainId": s.Default.ChainID, "displayOnly": true, "items": items})
	})
}
