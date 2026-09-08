package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"reflect"

	"tickergarden/backend/internal/readmodel"
)

// A syntactically valid revision is insufficient: it must identify the block
// carried by this finalized snapshot before it can authorize cache retention.
func validUpdateSnapshot(s readmodel.SyncStatus, chainID uint64) bool {
	return s.ChainID == chainID && s.Status == "synced" && s.Finality == "finalized" &&
		s.BlockNumber != nil && s.BlockHash != nil &&
		revisionPattern.MatchString(s.Revision) && s.Revision == *s.BlockNumber+":"+*s.BlockHash
}

// Updates invalidate endpoint families; clients refetch them pinned to sync.revision.
// This is a published snapshot comparison, not a chain-head event stream.
func updates(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fail := func(code int, reason string) { writeError(w, r, code, reason, "snapshot updates unavailable") }
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			fail(405, "method_not_allowed")
			return
		}
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
			fail(400, "invalid_query")
			return
		}
		for key, values := range q {
			if key != "since" || len(values) != 1 || !revisionPattern.MatchString(values[0]) {
				fail(400, "invalid_query")
				return
			}
		}
		if opts.ReadModels == nil {
			fail(503, "snapshot_unavailable")
			return
		}
		current, err := opts.ReadModels.Load(r.Context(), "")
		if err != nil || !validUpdateSnapshot(current.Sync, opts.ChainID) {
			fail(503, "snapshot_unavailable")
			return
		}
		mode := "reset"
		scopes := []string{"markets", "configs", "positions", "accounts"}
		since := q.Get("since")
		if since == current.Sync.Revision {
			mode = "unchanged"
			scopes = []string{}
		} else if since != "" {
			previous, e := opts.ReadModels.Load(r.Context(), since)
			if e != nil && !errors.Is(e, readmodel.ErrRevision) {
				fail(503, "snapshot_unavailable")
				return
			}
			if e == nil && (!validUpdateSnapshot(previous.Sync, opts.ChainID) || previous.Sync.Revision != since) {
				fail(503, "snapshot_unavailable")
				return
			}
			if e == nil {
				mode = "changed"
				scopes = []string{}
				if !reflect.DeepEqual(previous.Markets, current.Markets) {
					scopes = append(scopes, "markets")
				}
				if !reflect.DeepEqual(previous.Configs, current.Configs) {
					scopes = append(scopes, "configs")
				}
				if !reflect.DeepEqual(previous.Positions, current.Positions) {
					scopes = append(scopes, "positions")
				}
				if !reflect.DeepEqual(previous.Accounts, current.Accounts) {
					scopes = append(scopes, "accounts")
				}
			}
		}
		writeJSON(w, 200, map[string]any{"mode": mode, "sync": current.Sync, "invalidated": scopes, "pollAfterMs": 5000})
	}
}
