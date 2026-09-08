package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"tickergarden/backend/internal/displayprice"
	"tickergarden/backend/internal/readmodel"
)

var revisionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*):0x[0-9a-f]{64}$`)
var marketPath = regexp.MustCompile(`^/v1/markets/(0x[0-9a-fA-F]{64})$`)
var configPath = regexp.MustCompile(`^/v1/config/(asset|quote|baseline|template)$`)
var accountPath = regexp.MustCompile(`^/v1/users/(0x[0-9a-fA-F]{40})/accounts$`)
var positionPath = regexp.MustCompile(`^/v1/users/(0x[0-9a-fA-F]{40})/positions$`)
var assetPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

type cursor struct {
	Version  int    `json:"version"`
	Scope    string `json:"scope"`
	Filter   string `json:"filter"`
	Snapshot string `json:"snapshot"`
	After    string `json:"after"`
}
type page[T any] struct {
	Items      []T                  `json:"items"`
	NextCursor *string              `json:"nextCursor"`
	Sync       readmodel.SyncStatus `json:"sync"`
}

func paginate[T any](items []T, q url.Values, scope, filter string, sync readmodel.SyncStatus, identity func(T) string) (page[T], error) {
	result := page[T]{Items: []T{}, Sync: sync}
	limit := 50
	if q.Has("limit") {
		n, e := strconv.Atoi(q.Get("limit"))
		if e != nil || n < 1 || n > 100 {
			return result, errors.New("limit must be an integer between 1 and 100")
		}
		limit = n
	}
	after := ""
	if q.Has("cursor") {
		raw := q.Get("cursor")
		if len(raw) > 2048 {
			return result, errors.New("cursor too long")
		}
		decoded, e := base64.RawURLEncoding.Strict().DecodeString(raw)
		if e != nil || base64.RawURLEncoding.EncodeToString(decoded) != raw {
			return result, errors.New("invalid cursor encoding")
		}
		var fields map[string]json.RawMessage
		if json.Unmarshal(decoded, &fields) != nil || fields["after"] == nil || string(fields["after"]) == "null" {
			return result, errors.New("cursor is missing after identity")
		}
		var c cursor
		if json.Unmarshal(decoded, &c) != nil || c.Version != 1 || c.Scope != scope || c.Filter != filter || c.Snapshot != sync.Revision {
			return result, errors.New("cursor is malformed or belongs to a different query snapshot")
		}
		after = c.After
	}
	// Sort compact references and compute expensive identity keys once. Do not
	// clone or reorder the caller's potentially large market/config records.
	type indexedIdentity struct {
		key   string
		index int
	}
	ordered := make([]indexedIdentity, len(items))
	for i, item := range items {
		ordered[i] = indexedIdentity{identity(item), i}
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].key < ordered[j].key })
	start := sort.Search(len(ordered), func(i int) bool { return ordered[i].key > after })
	end := start + limit
	if end > len(ordered) {
		end = len(ordered)
	}
	for _, item := range ordered[start:end] {
		result.Items = append(result.Items, items[item.index])
	}
	if end < len(ordered) {
		payload, _ := json.Marshal(cursor{Version: 1, Scope: scope, Filter: filter, Snapshot: sync.Revision, After: ordered[end-1].key})
		v := base64.RawURLEncoding.EncodeToString(payload)
		result.NextCursor = &v
	}
	return result, nil
}
func readError(w http.ResponseWriter, status int, code, message string, sync readmodel.SyncStatus) {
	writeJSON(w, status, map[string]any{"error": code, "message": message, "sync": sync})
}
func reads(opts Options) http.HandlerFunc {
	var metricsMu sync.Mutex
	var metricsRevision string
	var metricsMarkets []readmodel.MarketReadModel
	enrichMetrics := func(r *http.Request, snap readmodel.Snapshot) ([]readmodel.MarketReadModel, error) {
		if opts.MarketMetrics == nil {
			return snap.Markets, errors.New("market ranking metrics are not configured")
		}
		metricsMu.Lock()
		defer metricsMu.Unlock()
		if metricsRevision == snap.Sync.Revision && metricsMarkets != nil {
			return append([]readmodel.MarketReadModel{}, metricsMarkets...), nil
		}
		refs := []displayprice.Reference{}
		if opts.DisplayPrices != nil {
			refs = opts.DisplayPrices.Read(time.Now().UTC())
		}
		metrics, err := opts.MarketMetrics.MarketMetrics(r.Context(), snap, refs)
		if err != nil || len(metrics) != len(snap.Markets) {
			return snap.Markets, errors.New("market ranking metrics unavailable")
		}
		items := append([]readmodel.MarketReadModel{}, snap.Markets...)
		for i := range items {
			metric, ok := metrics[items[i].MarketID]
			if !ok || metric == nil {
				return snap.Markets, errors.New("market ranking metrics incomplete")
			}
			items[i].Metrics = metric
		}
		metricsRevision, metricsMarkets = snap.Sync.Revision, items
		return append([]readmodel.MarketReadModel{}, items...), nil
	}
	return func(w http.ResponseWriter, r *http.Request) {
		empty := readmodel.Empty(opts.ChainID)
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeJSON(w, 405, map[string]any{"error": "read_only", "message": "this API does not accept write methods", "allowedMethods": []string{"GET"}, "sync": empty.Sync})
			return
		}
		q, e := url.ParseQuery(r.URL.RawQuery)
		if e != nil {
			readError(w, 400, "invalid_request", "invalid query encoding", empty.Sync)
			return
		}
		for _, vs := range q {
			if len(vs) != 1 {
				readError(w, 400, "invalid_request", "duplicate query parameter", empty.Sync)
				return
			}
		}
		revision := q.Get("revision")
		if q.Has("revision") && !revisionPattern.MatchString(revision) {
			readError(w, 400, "invalid_request", "invalid snapshot revision", empty.Sync)
			return
		}
		snap := empty
		if opts.ReadModels != nil {
			snap, e = opts.ReadModels.Load(r.Context(), revision)
		} else if revision != "" {
			e = readmodel.ErrRevision
		}
		if errors.Is(e, readmodel.ErrRevision) {
			readError(w, 400, "invalid_request", e.Error(), empty.Sync)
			return
		}
		if e != nil {
			opts.Logger.Error("read_model_unavailable")
			snap = empty
		}
		fail := func(e error) { readError(w, 400, "invalid_request", e.Error(), snap.Sync) }
		if r.URL.Path == "/health" {
			writeJSON(w, 200, map[string]any{"executionSpecId": "V1-EXEC-11", "status": "read-api", "readApiImplemented": true, "productRuntimeImplemented": true, "custody": false, "transactionSubmission": false, "sync": snap.Sync})
			return
		}
		if r.URL.Path == "/v1/markets" {
			marketItems := snap.Markets
			metricSort := q.Get("sort") == "volume24hUsd_desc" || q.Get("sort") == "marketCapUsd_desc"
			if enriched, metricErr := enrichMetrics(r, snap); metricErr == nil {
				marketItems = enriched
				if metricSort {
					available := false
					for _, market := range marketItems {
						if market.Metrics != nil && (q.Get("sort") == "volume24hUsd_desc" && market.Metrics.Volume24hUSD != nil || q.Get("sort") == "marketCapUsd_desc" && market.Metrics.MarketCapUSD != nil) {
							available = true
							break
						}
					}
					if !available {
						readError(w, 503, "market_metrics_unavailable", "no comparable USD market metrics are available", snap.Sync)
						return
					}
				}
			} else if metricSort {
				readError(w, 503, "market_metrics_unavailable", metricErr.Error(), snap.Sync)
				return
			}
			items, filter, identity, e := queryMarkets(marketItems, q)
			if errors.Is(e, ErrMarketIdentityUnavailable) {
				readError(w, 503, "identity_unavailable", e.Error(), snap.Sync)
				return
			}
			if e != nil {
				fail(e)
				return
			}
			p, e := paginate(items, q, "markets", filter, snap.Sync, identity)
			if e != nil {
				fail(e)
				return
			}
			writeJSON(w, 200, p)
			return
		}
		if match := marketPath.FindStringSubmatch(r.URL.Path); match != nil {
			for _, m := range snap.Markets {
				if m.MarketID == strings.ToLower(match[1]) {
					writeJSON(w, 200, map[string]any{"market": m, "sync": snap.Sync})
					return
				}
			}
			readError(w, 404, "market_not_found", "the canonical market was not found", snap.Sync)
			return
		}
		if match := configPath.FindStringSubmatch(r.URL.Path); match != nil {
			items := []readmodel.ConfigReadModel{}
			for _, c := range snap.Configs {
				if c.Kind == match[1] {
					items = append(items, c)
				}
			}
			p, e := paginate(items, q, "config:"+match[1], "all", snap.Sync, func(c readmodel.ConfigReadModel) string { return c.ID })
			if e != nil {
				fail(e)
				return
			}
			writeJSON(w, 200, p)
			return
		}
		if match := accountPath.FindStringSubmatch(r.URL.Path); match != nil {
			for key := range q {
				if key != "revision" && key != "limit" && key != "cursor" {
					fail(errors.New("unsupported account query"))
					return
				}
			}
			if snap.Accounts == nil || snap.Sync.Status != "synced" {
				readError(w, 503, "accounts_unavailable", "snapshot account coverage unavailable", snap.Sync)
				return
			}
			user := strings.ToLower(match[1])
			items := []readmodel.UserAccountReadModel{}
			for _, account := range *snap.Accounts {
				if account.User == user {
					items = append(items, account)
				}
			}
			p, e := paginate(items, q, "accounts", user, snap.Sync, func(a readmodel.UserAccountReadModel) string { return a.AssetUID })
			if e != nil {
				fail(e)
				return
			}
			writeJSON(w, 200, p)
			return
		}
		if match := positionPath.FindStringSubmatch(r.URL.Path); match != nil {
			user := strings.ToLower(match[1])
			items := []readmodel.UserPositionReadModel{}
			for _, p := range snap.Positions {
				if p.User == user {
					items = append(items, p)
				}
			}
			p, e := paginate(items, q, "positions", user, snap.Sync, func(p readmodel.UserPositionReadModel) string { return p.AssetUID + ":" + p.MarketID })
			if e != nil {
				fail(e)
				return
			}
			writeJSON(w, 200, p)
			return
		}
		readError(w, 404, "not_found", "route not found", snap.Sync)
	}
}
