package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"tickergarden/backend/internal/readmodel"
	"tickergarden/backend/internal/useractivity"
)

type ActivityReader interface {
	Load(context.Context, string, int, string) (useractivity.Page, error)
}

var activityAddress = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

func activityReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		invalid := func() {
			writeError(w, r, 400, "invalid_query", "expected canonical nonzero address, limit 1-100 and optional cursor")
		}
		account := chi.URLParam(r, "address")
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || !activityAddress.MatchString(account) || account == "0x0000000000000000000000000000000000000000" {
			invalid()
			return
		}
		for k, v := range q {
			if len(v) != 1 || (k != "limit" && k != "cursor") {
				invalid()
				return
			}
		}
		limit := 50
		if q.Has("limit") {
			n, e := strconv.Atoi(q.Get("limit"))
			if e != nil || strconv.Itoa(n) != q.Get("limit") || n < 1 || n > 100 {
				invalid()
				return
			}
			limit = n
		}
		cursor := q.Get("cursor")
		if len(cursor) > 1024 || (q.Has("cursor") && cursor == "") {
			invalid()
			return
		}
		unavailable := func() { writeError(w, r, 503, "activity_unavailable", "activity history is unavailable or incomplete") }
		if opts.Activities == nil {
			unavailable()
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		page, err := opts.Activities.Load(ctx, account, limit, cursor)
		if errors.Is(err, useractivity.ErrCursor) {
			invalid()
			return
		}
		if errors.Is(err, useractivity.ErrRevision) {
			writeError(w, r, 409, "activity_page_changed", "history changed; restart without cursor")
			return
		}
		if err != nil || ctx.Err() != nil || page.Account != account || page.ChainID != opts.ChainID || len(page.Items) > limit {
			unavailable()
			return
		}
		for _, item := range page.Items {
			if item.Account != account || item.ChainID != opts.ChainID {
				unavailable()
				return
			}
		}
		raw, e := json.Marshal(page)
		if e != nil || readmodel.ValidateResponse("UserActivityPage", raw) != nil {
			unavailable()
			return
		}
		writeJSON(w, 200, page)
	}
}
