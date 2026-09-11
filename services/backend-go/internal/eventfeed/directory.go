package eventfeed

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"time"
)

type Directory struct {
	Feed
	NextCursor *string `json:"nextCursor"`
}
type DirectoryReader interface {
	MarketDirectory(context.Context, string) (Directory, error)
}

func DirectoryHandler(reader DirectoryReader) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		cursor := r.URL.Query().Get("cursor")
		if cursor != "" && !regexp.MustCompile(`^0x[0-9a-f]{64}$`).MatchString(cursor) {
			w.WriteHeader(400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		v, e := reader.MarketDirectory(ctx, cursor)
		if e != nil {
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(v)
	})
}
