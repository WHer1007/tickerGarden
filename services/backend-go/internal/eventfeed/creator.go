package eventfeed

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type CreatorMarket struct {
	MarketID            string `json:"marketId"`
	MemeToken           string `json:"memeToken"`
	Creator             string `json:"creator"`
	CreationBlockNumber string `json:"creationBlockNumber"`
}
type CreatorMarkets struct {
	ChainID     uint64          `json:"chainId"`
	Address     string          `json:"address"`
	DisplayOnly bool            `json:"displayOnly"`
	Complete    bool            `json:"complete"`
	Items       []CreatorMarket `json:"items"`
	NextCursor  *string         `json:"nextCursor"`
}
type CreatorReader interface {
	CreatorMarkets(context.Context, string, string, int) (CreatorMarkets, error)
}

func CreatorHandler(reader CreatorReader) http.Handler {
	slots := make(chan struct{}, 2)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		address := strings.ToLower(r.URL.Query().Get("address"))
		cursor := r.URL.Query().Get("cursor")
		limit := 100
		var err error
		if raw := r.URL.Query().Get("limit"); raw != "" {
			limit, err = strconv.Atoi(raw)
		}
		if err != nil || limit < 1 || limit > 100 || !regexp.MustCompile(`^0x[0-9a-f]{40}$`).MatchString(address) || (cursor != "" && !regexp.MustCompile(`^0x[0-9a-f]{64}$`).MatchString(cursor)) {
			w.WriteHeader(400)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			w.WriteHeader(503)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		result, err := reader.CreatorMarkets(ctx, address, cursor, limit)
		if err != nil {
			w.WriteHeader(503)
			json.NewEncoder(w).Encode(map[string]string{"error": "creator_directory_unavailable"})
			return
		}
		json.NewEncoder(w).Encode(result)
	})
}
