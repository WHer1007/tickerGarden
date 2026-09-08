package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/rewards"
)

var rewardAddress = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

func rewardReads(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fail := func(status int, code, message string) {
			writeJSON(w, status, map[string]string{"error": code, "message": message})
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			fail(405, "read_only", "this API does not accept write methods")
			return
		}
		user := strings.ToLower(chi.URLParam(r, "address"))
		q, e := url.ParseQuery(r.URL.RawQuery)
		if e != nil || !rewardAddress.MatchString(user) {
			fail(400, "invalid_request", "invalid reward query")
			return
		}
		for k, v := range q {
			if len(v) != 1 || (k != "revision" && k != "limit" && k != "cursor") {
				fail(400, "invalid_request", "invalid reward query")
				return
			}
		}
		limit := 50
		if q.Has("limit") {
			limit, e = strconv.Atoi(q.Get("limit"))
			if e != nil || limit < 1 || limit > 100 {
				fail(400, "invalid_request", "invalid limit")
				return
			}
		}
		rev, after := q.Get("revision"), ""
		if q.Has("revision") && !revisionPattern.MatchString(rev) {
			fail(400, "invalid_request", "invalid revision")
			return
		}
		if q.Has("cursor") {
			raw := q.Get("cursor")
			data, err := base64.RawURLEncoding.Strict().DecodeString(raw)
			var c cursor
			if len(raw) > 2048 || err != nil || base64.RawURLEncoding.EncodeToString(data) != raw || json.Unmarshal(data, &c) != nil || c.Version != 1 || c.Scope != "rewards" || c.Filter != user || c.After == "" || !revisionPattern.MatchString(c.Snapshot) || (rev != "" && rev != c.Snapshot) {
				fail(400, "invalid_request", "invalid reward cursor")
				return
			}
			rev, after = c.Snapshot, c.After
		}
		if opts.Rewards == nil {
			fail(503, "rewards_unavailable", "reward observations unavailable")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		result, err := opts.Rewards.LoadRewards(ctx, user, rev)
		if errors.Is(err, rewards.ErrRevision) {
			fail(400, "invalid_request", err.Error())
			return
		}
		if err != nil {
			fail(503, "rewards_unavailable", "reward observations unavailable")
			return
		}
		items := []deployment.StateObservation{}
		var next *string
		for _, row := range result.Items {
			if row.Key <= after {
				continue
			}
			if len(items) == limit {
				data, _ := json.Marshal(cursor{Version: 1, Scope: "rewards", Filter: user, Snapshot: result.Source.Revision, After: items[len(items)-1].Key})
				s := base64.RawURLEncoding.EncodeToString(data)
				next = &s
				break
			}
			items = append(items, row)
		}
		writeJSON(w, 200, map[string]any{"items": items, "nextCursor": next, "source": result.Source})
	}
}
