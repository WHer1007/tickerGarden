package eventfeed

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type HolderMarket struct {
	MarketID  string `json:"marketId"`
	MemeToken string `json:"memeToken"`
	Name      string `json:"name"`
	Symbol    string `json:"symbol"`
}
type HolderMarkets struct {
	ChainID  uint64         `json:"chainId"`
	Items    []HolderMarket `json:"items"`
	Complete bool           `json:"complete"`
}
type HolderReader interface {
	HolderMarkets(context.Context, string) (HolderMarkets, error)
}

func HolderHandler(reader HolderReader) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if len(q) > 128 {
			w.WriteHeader(400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		result, err := reader.HolderMarkets(ctx, q)
		if err != nil {
			w.WriteHeader(503)
			json.NewEncoder(w).Encode(map[string]string{"error": "holder_directory_unavailable"})
			return
		}
		json.NewEncoder(w).Encode(result)
	})
}
