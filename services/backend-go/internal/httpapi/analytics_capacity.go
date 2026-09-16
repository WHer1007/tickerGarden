package httpapi

import "net/http"

// Complete-history analytics retain receipt/transfer data while querying. Bound
// admitted work across all analytics routes in this API instance, with no queue.
// The limit is a resource guard, not a production throughput guarantee.
const analyticsConcurrentRequests = 4

// Transaction status has its own small pool so complete-history analytics
// cannot starve receipt/status feedback.
const transactionConcurrentRequests = 2

func analyticsCapacity(limit int) func(http.HandlerFunc) http.HandlerFunc {
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
				writeError(w, r, http.StatusServiceUnavailable, "analytics_unavailable", "analytics capacity is temporarily exhausted; retry later")
			}
		}
	}
}
