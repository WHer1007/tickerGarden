package tokendetail

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Dune polls an already scheduled query; page requests never execute SQL, spend
// query compute, or send the API key to the browser. Cache replacement is atomic.
type Dune struct {
	QueryID     string
	APIKey      string
	Client      *http.Client
	mu          sync.RWMutex
	reports     map[string]Report
	refreshMu   sync.Mutex
	lastRefresh time.Time
	refreshing  chan struct{}
}

const dunePollInterval = 10 * time.Minute

func NewDune(id, key string) (*Dune, error) {
	if !integer.MatchString(id) || id == "0" || len(id) > 12 || key == "" {
		return nil, errors.New("TG_DUNE_DETAIL_QUERY_ID and TG_DUNE_API_KEY must be configured together")
	}
	return &Dune{QueryID: id, APIKey: key, Client: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

// EnsureRefresh refreshes on demand, at most once per ten minutes. Concurrent
// callers share the same in-flight request. A failed refresh leaves the prior
// result available until its source expiry is enforced by Get.
func (d *Dune) EnsureRefresh(ctx context.Context, chain uint64) error {
	d.refreshMu.Lock()
	if !d.lastRefresh.IsZero() && time.Since(d.lastRefresh) < dunePollInterval {
		d.refreshMu.Unlock()
		return nil
	}
	if d.refreshing != nil {
		d.refreshMu.Unlock()
		return nil
	}
	wait := make(chan struct{})
	d.refreshing = wait
	d.lastRefresh = time.Now()
	d.refreshMu.Unlock()
	// Page requests must never wait on a slow provider. The request context is
	// intentionally detached so a client disconnect cannot cancel the refresh.
	go func() {
		refreshCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
		defer cancel()
		_ = d.Refresh(refreshCtx, chain)
		d.refreshMu.Lock()
		d.refreshing = nil
		close(wait)
		d.refreshMu.Unlock()
	}()
	return nil
}
func (d *Dune) Refresh(ctx context.Context, chain uint64) error {
	req, e := http.NewRequestWithContext(ctx, "GET", "https://api.dune.com/api/v1/query/"+d.QueryID+"/results?limit=10000", nil)
	if e != nil {
		return e
	}
	req.Header.Set("X-Dune-API-Key", d.APIKey)
	client := d.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, e := client.Do(req)
	if e != nil {
		return ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return ErrUnavailable
	}
	raw, e := io.ReadAll(io.LimitReader(resp.Body, (16<<20)+1))
	if e != nil || len(raw) > 16<<20 {
		return ErrUnavailable
	}
	var envelope struct {
		QueryID          uint64    `json:"query_id"`
		ExecutionID      string    `json:"execution_id"`
		State            string    `json:"state"`
		ExecutionEndedAt time.Time `json:"execution_ended_at"`
		NextURI          *string   `json:"next_uri"`
		NextOffset       *int      `json:"next_offset"`
		Result           struct {
			Rows []struct {
				Payload string `json:"payload"`
			} `json:"rows"`
			Metadata struct {
				TotalRowCount int `json:"total_row_count"`
			} `json:"metadata"`
		} `json:"result"`
	}
	if json.Unmarshal(raw, &envelope) != nil || strconv.FormatUint(envelope.QueryID, 10) != d.QueryID || envelope.ExecutionID == "" || envelope.State != "QUERY_STATE_COMPLETED" || envelope.NextURI != nil || envelope.NextOffset != nil || envelope.Result.Metadata.TotalRowCount != len(envelope.Result.Rows) || len(envelope.Result.Rows) > 10000 {
		return ErrUnavailable
	}
	now := time.Now()
	if envelope.ExecutionEndedAt.IsZero() || now.Sub(envelope.ExecutionEndedAt) > 20*time.Minute || envelope.ExecutionEndedAt.After(now.Add(30*time.Second)) {
		return ErrUnavailable
	}
	next := map[string]Report{}
	for _, row := range envelope.Result.Rows {
		var r Report
		if json.Unmarshal([]byte(row.Payload), &r) != nil || Validate(r, chain, now) != nil {
			return ErrUnavailable
		}
		key := r.MarketID + ":" + r.Period
		if _, exists := next[key]; exists {
			return ErrUnavailable
		}
		for k, s := range r.Sources {
			s.Provider = "dune"
			s.QueryID = d.QueryID
			s.ExecutionID = envelope.ExecutionID
			s.CachedAt = uint64(now.Unix())
			r.Sources[k] = s
		}
		r.Reasons = map[string]string{}
		next[key] = r
	}
	d.mu.Lock()
	d.reports = next
	d.mu.Unlock()
	return nil
}
func (d *Dune) Get(chain uint64, market, period string, now time.Time) (Report, bool) {
	if d == nil {
		return Report{}, false
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	r, ok := d.reports[market+":"+period]
	if !ok || Validate(r, chain, now) != nil {
		return Report{}, false
	}
	for section := range r.Sources {
		if !fresh(r.Sources[section], now) {
			return Report{}, false
		}
	}
	return r, true
}
