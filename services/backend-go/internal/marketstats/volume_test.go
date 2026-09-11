package marketstats

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestVolumePages(t *testing.T) {
	for _, mode := range []string{"complete", "repeated", "rate-limit"} {
		t.Run(mode, func(t *testing.T) {
			calls, count := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				logs := make([]volumeLog, 1000)
				for i := range logs {
					logs[i].TransactionHash = r.URL.Query().Get("page")
				}
				if mode == "repeated" {
					for i := range logs {
						logs[i].TransactionHash = "same"
					}
				}
				if mode == "rate-limit" {
					json.NewEncoder(w).Encode(map[string]any{"status": "0", "message": "Rate limit", "result": []volumeLog{}})
					return
				}
				if mode == "complete" && calls == 2 {
					logs = logs[:1]
				}
				json.NewEncoder(w).Encode(map[string]any{"status": "1", "result": logs})
			}))
			defer server.Close()
			e := eachVolumePage(context.Background(), server.Client(), server.URL, url.Values{}, func(logs []volumeLog) error { count += len(logs); return nil })
			if mode == "complete" {
				if e != nil || count != 1001 || calls != 2 {
					t.Fatalf("count %d calls %d error %v", count, calls, e)
				}
			} else if e == nil {
				t.Fatal("incomplete coverage accepted")
			}
		})
	}
}
