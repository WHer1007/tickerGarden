package demandevents

import (
	"encoding/json"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var displayMarketID = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

// Shared public history. No RPC or signing work is performed by a page request.
func (s *Service) MarketDisplayHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		id := r.URL.Query().Get("marketId")
		if !displayMarketID.MatchString(id) {
			http.Error(w, "Invalid market", 400)
			return
		}
		var saved []byte
		if s.Pool.QueryRow(r.Context(), `SELECT snapshot FROM tickergarden.display_snapshots WHERE scope_id=$1 AND name=$2 AND updated_at>clock_timestamp()-interval '10 minutes'`, s.Default.ID, "market:"+id).Scan(&saved) == nil {
			var version struct {
				SchemaVersion int `json:"schemaVersion"`
			}
			if json.Unmarshal(saved, &version) == nil && version.SchemaVersion == 2 {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Cache-Control", "no-store")
				w.Write(saved)
				return
			}
		}
		registry, vault, factory := "", "", ""
		for a, m := range s.Default.Modules {
			switch m {
			case "MarketRegistryV1":
				registry = a
			case "ProtocolFeeVault":
				vault = a
			case "TickerGardenFactoryV1":
				factory = a
			}
		}
		var created, start, through uint64
		var observed *time.Time
		err := s.Pool.QueryRow(r.Context(), `SELECT e.block_number,d.start_block,d.processed_through,d.observed_at FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes d USING(scope_id) WHERE e.scope_id=$1 AND e.block_number<=d.processed_through AND e.payload->'event'->>'emitter'=$2 AND e.payload->'event'->>'signature' LIKE 'MarketCreated(%' AND e.payload->'event'->'args'->>'marketId'=$3 LIMIT 1`, s.Default.ID, factory, id).Scan(&created, &start, &through, &observed)
		if err != nil {
			http.Error(w, "Market unavailable", 404)
			return
		}
		type fee struct {
			Recipient string `json:"recipient"`
			Asset     string `json:"asset"`
			Amount    string `json:"amountRaw"`
		}
		fees := []fee{}
		totals := map[string]*big.Int{}
		rows, err := s.Pool.Query(r.Context(), `SELECT payload->'event' FROM tickergarden.demand_event_records WHERE scope_id=$1 AND block_number<=$2 AND payload->'event'->>'emitter'=$3 AND payload->'event'->'args'->>'marketId'=$4 AND (payload->'event'->>'signature' LIKE 'CurveFeesSwept(%' OR payload->'event'->>'signature' LIKE 'FeeBucketsCredited(%' OR payload->'event'->>'signature' LIKE 'HolderFeesAccrued(%')`, s.Default.ID, through, vault, id)
		if err != nil {
			http.Error(w, "Statistics unavailable", 503)
			return
		}
		valid := true
		for rows.Next() {
			var raw []byte
			var event struct {
				Signature string
				Args      map[string]any
			}
			if rows.Scan(&raw) != nil || json.Unmarshal(raw, &event) != nil {
				valid = false
				break
			}
			asset, _ := event.Args["feeAsset"].(string)
			if asset == "" {
				asset, _ = event.Args["quoteAsset"].(string)
			}
			fields := map[string]string{"creator": "creatorAmount", "platform": "platformAmount"}
			if strings.HasPrefix(event.Signature, "FeeBucketsCredited(") {
				fields["stakers"] = "stakerAmount"
			}
			if strings.HasPrefix(event.Signature, "HolderFeesAccrued(") {
				fields = map[string]string{"holders": "amount"}
			}
			for bucket, field := range fields {
				v, ok := event.Args[field].(string)
				n, good := new(big.Int).SetString(v, 10)
				if !ok || !good || n.Sign() < 0 || len(asset) != 42 {
					valid = false
					break
				}
				key := bucket + ":" + asset
				if totals[key] == nil {
					totals[key] = new(big.Int)
				}
				totals[key].Add(totals[key], n)
			}
		}
		if rows.Err() != nil {
			valid = false
		}
		rows.Close()
		for key, n := range totals {
			parts := strings.SplitN(key, ":", 2)
			fees = append(fees, fee{parts[0], parts[1], n.String()})
		}
		var raw []byte
		var state struct {
			VolumeVersion int     `json:"volumeVersion"`
			VolumeRaw     *string `json:"volumeRaw"`
			VolumeAt      int64   `json:"volumeAt"`
		}
		if s.Pool.QueryRow(r.Context(), `SELECT state FROM tickergarden.market_statistics WHERE chain_id=$1 AND registry=$2 AND market_id=$3`, s.Default.ChainID, registry, id).Scan(&raw) == nil {
			_ = json.Unmarshal(raw, &state)
		}
		at := int64(0)
		if observed != nil {
			at = observed.Unix()
		}
		fresh := at > 0 && time.Now().Unix()-at < 1200 && at <= time.Now().Unix()
		if state.VolumeVersion < 2 || time.Now().Unix()-state.VolumeAt >= 1200 {
			state.VolumeRaw = nil
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		result := map[string]any{"schemaVersion": 2, "chainId": s.Default.ChainID, "displayOnly": true, "marketId": id, "observedAt": at, "feeCoverage": valid && fresh && start <= created, "volumeRaw": state.VolumeRaw, "volumeAt": state.VolumeAt, "feeDistribution": fees}
		encoded, err := json.Marshal(result)
		if err != nil {
			http.Error(w, "Statistics unavailable", 503)
			return
		}
		if valid && fresh {
			_, _ = s.Pool.Exec(r.Context(), `INSERT INTO tickergarden.display_snapshots(scope_id,name,snapshot) VALUES($1,$2,$3) ON CONFLICT(scope_id,name) DO UPDATE SET snapshot=excluded.snapshot,updated_at=clock_timestamp()`, s.Default.ID, "market:"+id, encoded)
		}
		w.Write(encoded)
	})
}
