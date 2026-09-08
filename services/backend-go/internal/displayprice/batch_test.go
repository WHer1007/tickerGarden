package displayprice

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestBatchSharesFailuresAndRecovers(t *testing.T) {
	p, target, _ := priceFixture(t, "")
	original := p.Client.Transport
	var mu sync.Mutex
	counts := map[string]int{}
	fail := false
	p.Client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		counts[r.URL.Path]++
		broken := fail && r.URL.Path == "/rhj/assets"
		mu.Unlock()
		if broken {
			return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("{}"))}, nil
		}
		return original.RoundTrip(r)
	})
	run := func(want string) {
		t.Helper()
		shared := &batch{}
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				r := p.fetch(context.Background(), target, time.Now().UTC(), shared)
				if r.Status != want {
					t.Errorf("want %s got %+v", want, r)
				}
			}()
		}
		wg.Wait()
	}
	run("available")
	if counts["/rhj/assets"] != 1 || counts["/rhj/corporate-actions"] != 1 || counts["/rhj/prices/AAPL"] != 8 {
		t.Fatalf("not shared: %v", counts)
	}
	fail = true
	run("unavailable")
	if counts["/rhj/assets"] != 2 || counts["/rhj/corporate-actions"] != 1 || counts["/rhj/prices/AAPL"] != 8 {
		t.Fatalf("failure not shared: %v", counts)
	}
	fail = false
	run("available")
	if counts["/rhj/assets"] != 3 || counts["/rhj/corporate-actions"] != 2 || counts["/rhj/prices/AAPL"] != 16 {
		t.Fatalf("not recovered: %v", counts)
	}
}
