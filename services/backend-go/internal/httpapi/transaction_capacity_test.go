package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTransactionCapacityIsolatedFromAnalytics(t *testing.T) {
	blocked := &blockedGlobalReader{entered: make(chan struct{}, analyticsConcurrentRequests), release: make(chan struct{})}
	defer close(blocked.release)
	h := New(Options{GlobalHolders: blocked, Transactions: &transactionFixture{}, ChainID: 4663})
	for i := 0; i < analyticsConcurrentRequests; i++ {
		go h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/v1/stats/holders", nil))
	}
	for i := 0; i < analyticsConcurrentRequests; i++ {
		select {
		case <-blocked.entered:
		case <-time.After(time.Second):
			t.Fatal("analytics request did not occupy its slot")
		}
	}

	w := httptest.NewRecorder()
	txHash := "0x" + strings.Repeat("2", 64)
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/transactions/"+txHash, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("transaction status was starved by analytics: %d %s", w.Code, w.Body.String())
	}
}
