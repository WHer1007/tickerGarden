package httpapi

import "net/http"

// Bound whole-snapshot decoding, comparison, sorting and response serialization
// together. Updates may retain two snapshots. This is per API instance, not a
// throughput guarantee or a replacement for deployment memory limits.
const snapshotConcurrentRequests = 8

func snapshotCapacity(limit int) func(http.HandlerFunc) http.HandlerFunc {
	slots := make(chan struct{}, limit)
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				next(w, r)
				return
			}
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
				next(w, r)
			default:
				w.Header().Set("Retry-After", "5")
				writeError(w, r, http.StatusServiceUnavailable, "snapshot_unavailable", "snapshot capacity is temporarily exhausted; retry later")
			}
		}
	}
}
