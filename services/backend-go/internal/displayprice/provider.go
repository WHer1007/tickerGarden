// Package displayprice provides display-only USD estimates, never execution inputs.
package displayprice

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

const Source = "robinhood_rest"
const baseURL = "https://api.robinhood.com/rhj"

var decimalRE = regexp.MustCompile(`^(0|[1-9][0-9]{0,59})(\.[0-9]{1,18})?$`)
var symbolRE = regexp.MustCompile(`^[A-Z][A-Z0-9.\-]{0,15}$`)
var uidRE = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var addressRE = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var errData = errors.New("display reference unavailable")

type Target struct {
	ChainID  uint64 `json:"chainId"`
	Token    string `json:"token"`
	AssetUID string `json:"assetUid"`
	Symbol   string `json:"symbol"`
}
type Reference struct {
	Target
	Source      string     `json:"source"`
	Unit        string     `json:"unit"`
	Status      string     `json:"status"`
	Reason      string     `json:"reason,omitempty"`
	BidUSD      *string    `json:"bidUsd"`
	AskUSD      *string    `json:"askUsd"`
	Multiplier  *string    `json:"multiplier"`
	AsOf        *time.Time `json:"asOf"`
	ExpiresAt   *time.Time `json:"expiresAt"`
	RetrievedAt time.Time  `json:"retrievedAt"`
}

func ValidTarget(t Target) bool {
	return t.ChainID > 0 && addressRE.MatchString(t.Token) && t.Token != "0x"+strings.Repeat("0", 40) && uidRE.MatchString(t.AssetUID) && symbolRE.MatchString(t.Symbol)
}
func missing(t Target, now time.Time, reason string) Reference {
	return Reference{Target: t, Source: Source, Unit: "USD_PER_WHOLE_TOKEN", Status: "unavailable", Reason: reason, RetrievedAt: now}
}

type Provider struct {
	Client *http.Client
	MaxAge time.Duration
}

func NewProvider() Provider {
	return Provider{Client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, MaxAge: 60 * time.Second}
}
func (p Provider) get(ctx context.Context, path string, v any) error {
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if e != nil {
		return errData
	}
	req.Header.Set("Accept", "application/json")
	res, e := p.Client.Do(req)
	if e != nil {
		return requestFailure(ctx, e)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		switch {
		case res.StatusCode == 429:
			return upstreamFailure("rate_limited")
		case res.StatusCode == 404:
			return upstreamFailure("not_found")
		case res.StatusCode == 401 || res.StatusCode == 403:
			return upstreamFailure("access_denied")
		case res.StatusCode >= 500:
			return upstreamFailure("server_error")
		default:
			return upstreamFailure("http_error")
		}
	}
	raw, e := io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	if e != nil {
		return requestFailure(ctx, e)
	}
	if len(raw) > 2<<20 {
		return upstreamFailure("response_too_large")
	}
	if json.Unmarshal(raw, v) != nil {
		return upstreamFailure("invalid_json")
	}
	return nil
}

type deployment struct {
	ChainID uint64 `json:"chainId"`
	Address string `json:"contractAddress"`
}
type asset struct {
	ID          string       `json:"id"`
	Symbol      string       `json:"tokenSymbol"`
	Status      string       `json:"status"`
	Multiplier  *string      `json:"currentMultiplier"`
	Pending     *string      `json:"pendingMultiplier"`
	Deployments []deployment `json:"deployments"`
}
type quote struct {
	Symbol      string       `json:"tokenSymbol"`
	Bid         string       `json:"bid"`
	Ask         string       `json:"ask"`
	Currency    string       `json:"currency"`
	Halt        *bool        `json:"isTradingHalt"`
	Generated   string       `json:"generatedAt"`
	Deployments []deployment `json:"deployments"`
}

func matches(ds []deployment, t Target) bool {
	n := 0
	for _, d := range ds {
		if d.ChainID == t.ChainID {
			if !strings.EqualFold(d.Address, t.Token) {
				return false
			}
			n++
		}
	}
	return n == 1
}
func scaled(s string) (*big.Int, int, error) {
	if !decimalRE.MatchString(s) {
		return nil, 0, errData
	}
	parts := strings.Split(s, ".")
	scale := 0
	if len(parts) == 2 {
		scale = len(parts[1])
	}
	n, ok := new(big.Int).SetString(strings.Join(parts, ""), 10)
	if !ok || n.Sign() <= 0 {
		return nil, 0, errData
	}
	return n, scale, nil
}
func product(a, b string) (string, error) {
	x, xs, e := scaled(a)
	if e != nil {
		return "", e
	}
	y, ys, e := scaled(b)
	if e != nil {
		return "", e
	}
	s := new(big.Int).Mul(x, y).String()
	scale := xs + ys
	if scale > 0 {
		if len(s) <= scale {
			s = strings.Repeat("0", scale-len(s)+1) + s
		}
		s = s[:len(s)-scale] + "." + s[len(s)-scale:]
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s, nil
}

// A batch owns one immutable observation of shared upstream data. Failed reads
// are shared too; a new refresh creates a new batch and retries normally.
type batch struct {
	bulk        bool
	pricesOnce  sync.Once
	quotes      []quote
	pricesErr   error
	quoteMu     sync.Mutex
	nextQuote   time.Time
	assetsOnce  sync.Once
	assets      []asset
	assetsErr   error
	actionsOnce sync.Once
	actions     []corporateAction
	actionsErr  error
}
type corporateAction struct {
	Symbol string `json:"tokenSymbol"`
	Status string `json:"status"`
}

func (b *batch) loadAssets(ctx context.Context, p Provider) {
	b.assetsOnce.Do(func() {
		var response struct {
			Assets []asset `json:"assets"`
		}
		b.assetsErr = p.get(ctx, "/assets", &response)
		b.assets = response.Assets
	})
}
func (b *batch) loadActions(ctx context.Context, p Provider) {
	b.actionsOnce.Do(func() {
		var response struct {
			Actions []corporateAction `json:"corpActions"`
		}
		b.actionsErr = p.get(ctx, "/corporate-actions", &response)
		b.actions = response.Actions
		if b.actions == nil {
			b.actionsErr = errData
		}
	})
}

func (p Provider) Fetch(ctx context.Context, t Target, now time.Time) Reference {
	return p.fetch(ctx, t, now, &batch{})
}
func (p Provider) fetch(ctx context.Context, t Target, now time.Time, shared *batch) Reference {
	started := time.Now()
	fail := func(reason string) Reference { return missing(t, now.Add(time.Since(started)), reason) }
	if !ValidTarget(t) || p.Client == nil || p.MaxAge < 15*time.Second || p.MaxAge > 5*time.Minute {
		return fail("invalid_configuration")
	}
	shared.loadAssets(ctx, p)
	if shared.assetsErr != nil {
		return fail(failureReason("assets", shared.assetsErr))
	}
	var selected *asset
	for i := range shared.assets {
		a := &shared.assets[i]
		if a.ID == t.AssetUID || a.Symbol == t.Symbol {
			if selected != nil || a.ID != t.AssetUID || a.Symbol != t.Symbol || !matches(a.Deployments, t) {
				return fail("asset_mismatch")
			}
			selected = a
		}
	}
	if selected == nil {
		return fail("asset_missing")
	}
	a := selected
	if a.Status != "ASSET_STATUS_ACTIVE" || a.Multiplier == nil || a.Pending == nil {
		return fail("asset_unavailable")
	}
	if *a.Pending != "" {
		return fail("pending_multiplier")
	}
	shared.loadActions(ctx, p)
	if shared.actionsErr != nil {
		return fail(failureReason("corporate_actions", shared.actionsErr))
	}
	for _, action := range shared.actions {
		if action.Symbol == t.Symbol && action.Status != "CORPORATE_ACTION_STATUS_COMPLETED" {
			return fail("corporate_action_pending")
		}
	}
	q, reason := shared.price(ctx, p, t.Symbol)
	if reason != "" {
		return fail(reason)
	}
	if q.Symbol != t.Symbol || q.Currency != "USD" || !matches(q.Deployments, t) || q.Halt == nil {
		return fail("quote_mismatch")
	}
	if *q.Halt {
		return fail("trading_halt")
	}
	bid, e := product(q.Bid, *a.Multiplier)
	if e != nil {
		return fail("invalid_price")
	}
	ask, e := product(q.Ask, *a.Multiplier)
	if e != nil {
		return fail("invalid_price")
	}
	b, _ := new(big.Rat).SetString(bid)
	c, _ := new(big.Rat).SetString(ask)
	if b.Cmp(c) > 0 {
		return fail("crossed_price")
	}
	observedAt := now.Add(time.Since(started))
	stamp, e := time.Parse(time.RFC3339Nano, q.Generated)
	if e != nil || stamp.After(observedAt) {
		return fail("invalid_timestamp")
	}
	expiry := stamp.Add(p.MaxAge)
	out := Reference{Target: t, Source: Source, Unit: "USD_PER_WHOLE_TOKEN", Status: "available", BidUSD: &bid, AskUSD: &ask, Multiplier: a.Multiplier, AsOf: &stamp, ExpiresAt: &expiry, RetrievedAt: observedAt}
	return expire(out, observedAt)
}
func expire(r Reference, now time.Time) Reference {
	if r.ExpiresAt != nil && !now.Before(*r.ExpiresAt) {
		r.Status = "stale"
		r.Reason = "price_expired"
		r.BidUSD = nil
		r.AskUSD = nil
	}
	return r
}
