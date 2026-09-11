// Package marketstats maintains display-only directory statistics independently
// of financially reconciled snapshots. Request handlers never wait for RPC.
package marketstats

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/displayprice"

	"tickergarden/backend/internal/readmodel"
)

const Basis = "TOTAL_SUPPLY_X_POOL_SPOT_X_QUOTE_USD"
const zero = "0x0000000000000000000000000000000000000000"
const swap = "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"

var marketID = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

type RPC interface {
	BurnLogs(context.Context, string, string, uint64, uint64) ([]chainrpc.Log, error)
	Header(context.Context, string) (chainrpc.Header, error)
	CallAt(context.Context, string, string, string) ([]byte, error)
	ProjectLogs(context.Context, []string, []string, uint64, uint64) ([]chainrpc.Log, error)
	PoolLogs(context.Context, string, []string, []string, uint64, uint64) ([]chainrpc.Log, error)
}
type Prices interface {
	Read(time.Time) []displayprice.Reference
}
type BuyHistory struct {
	Buy  readmodel.LastBuyReadModel
	Hash string
}
type State struct {
	VolumeVersion                            uint32       `json:"volumeVersion,omitempty"`
	VolumeThrough                            uint64       `json:"volumeThrough,omitempty"`
	VolumeRaw                                *string      `json:"volumeRaw,omitempty"`
	VolumeAttemptAt                          int64        `json:"volumeAttemptAt,omitempty"`
	VolumeAt                                 int64        `json:"volumeAt,omitempty"`
	Buys                                     []BuyHistory `json:"buys,omitempty"`
	MarketID                                 string       `json:"marketId"`
	Token, Curve, Quote, Hook, Pool, Manager string
	Phase                                    string
	Decimals                                 uint8
	Supply, Price                            string
	Cursor                                   uint64
	Hash                                     string
	ObservedAt                               int64 `json:"observedAt"`
	StatsAt                                  int64
	LastBuy                                  *readmodel.LastBuyReadModel       `json:"lastBuy,omitempty"`
	Metrics                                  *readmodel.MarketMetricsReadModel `json:"metrics,omitempty"`
}
type Service struct {
	Pool        *pgxpool.Pool
	RPC         RPC
	Chain       uint64
	Registry    string
	Prices      Prices
	mu          sync.RWMutex
	states      map[string]State
	pending     map[string]bool
	rejected    map[string]time.Time
	activeUntil time.Time
	wake        chan struct{}
	// One worker owns RPC reads; no request can multiply the request rate.
}

func New(ctx context.Context, pool *pgxpool.Pool, rpc RPC, chain uint64, registry string, prices Prices) (*Service, error) {
	s := &Service{Pool: pool, RPC: rpc, Chain: chain, Registry: registry, Prices: prices, states: map[string]State{}, pending: map[string]bool{}, rejected: map[string]time.Time{}, wake: make(chan struct{}, 1)}
	rows, err := pool.Query(ctx, `SELECT state FROM tickergarden.market_statistics WHERE chain_id=$1 AND registry=$2`, chain, registry)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		var v State
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if json.Unmarshal(raw, &v) != nil {
			return nil, errors.New("invalid statistics cache")
		}
		if v.VolumeVersion < 2 {
			v.VolumeRaw = nil
			v.VolumeAt = 0
			v.VolumeAttemptAt = 0
		}
		s.states[v.MarketID] = v
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	go s.run(ctx)
	return s, nil
}
func (s *Service) Touch(ids []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activeUntil = time.Now().Add(45 * time.Second)
	for id, until := range s.rejected {
		if time.Now().After(until) {
			delete(s.rejected, id)
		}
	}
	for _, id := range ids {
		if marketID.MatchString(id) {
			if _, ok := s.states[id]; !ok && len(s.pending) < 128 && time.Now().After(s.rejected[id]) {
				s.pending[id] = true
			}
		}
	}
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
func (s *Service) Snapshot() map[string]State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]State{}
	for id, v := range s.states {
		out[id] = v
	}
	return out
}
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		w.WriteHeader(405)
		return
	}
	ids := []string{}
	if raw := r.URL.Query().Get("markets"); raw != "" {
		ids = strings.Split(raw, ",")
	}
	if len(ids) > 100 {
		http.Error(w, "Too many markets", 400)
		return
	}
	for _, id := range ids {
		if !marketID.MatchString(id) {
			http.Error(w, "Invalid market", 400)
			return
		}
	}
	s.Touch(ids)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{"chainId": s.Chain, "registry": s.Registry, "displayOnly": true, "items": s.PublicSnapshot()})
}
func (s *Service) run(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	var next time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.wake:
		}
		if time.Now().Before(next) {
			continue
		}
		next = time.Now().Add(10 * time.Second)
		s.mu.RLock()
		active := time.Now().Before(s.activeUntil)
		s.mu.RUnlock()
		if !active {
			for _, v := range s.Snapshot() {
				before := v.StatsAt
				s.calculate(&v, time.Now())
				if v.StatsAt != before {
					s.save(ctx, v)
				}
			}
			continue
		}
		work, cancel := context.WithTimeout(ctx, 25*time.Second)
		s.tick(work)
		cancel()
	}
}
func (s *Service) tick(ctx context.Context) {
	// Discover new projects from already persisted local events, never scan chain history here.
	rows, err := s.Pool.Query(ctx, `SELECT DISTINCT payload->'event'->'args'->>'marketId' FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes d USING(scope_id) WHERE d.chain_id=$1 AND d.config->'modules'->>$2='MarketRegistryV1' AND payload->'event'->>'signature'='MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)' AND e.block_number<=d.processed_through LIMIT 10000`, s.Chain, s.Registry)
	if err == nil {
		ids := []string{}
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
		s.mu.Lock()
		for _, id := range ids {
			if _, ok := s.states[id]; !ok && len(s.pending) < 128 && time.Now().After(s.rejected[id]) {
				s.pending[id] = true
			}
		}
		s.mu.Unlock()
	}
	h, err := s.RPC.Header(ctx, "latest")
	if err != nil {
		return
	}
	head, err := h.Height()
	if err != nil {
		return
	}
	s.mu.Lock()
	todo := []string{}
	for id := range s.pending {
		todo = append(todo, id)
	}
	sort.Strings(todo)
	if len(todo) > 4 {
		todo = todo[:4]
	}
	s.mu.Unlock()
	for _, id := range todo {
		v, err := s.initialize(ctx, id, h)
		s.mu.Lock()
		delete(s.pending, id)
		if err != nil {
			if len(s.rejected) < 1024 {
				s.rejected[id] = time.Now().Add(time.Minute)
			}
			slog.Warn("market_statistics_initialization_failed", "market_id", id, "error", err)
		}
		s.mu.Unlock()
		if err == nil {
			s.save(ctx, v)
		}
	}
	states := s.Snapshot()
	if p, ok := s.Prices.(*PriceService); ok {
		quotes := []string{}
		for _, v := range states {
			quotes = append(quotes, v.Quote)
		}
		p.RefreshStocks(ctx, quotes, h)
	}
	batch := &rangeRPC{RPC: s.RPC, headers: map[string]chainrpc.Header{h.Number: h}, logs: map[string][]chainrpc.Log{}}
	for _, v := range states {
		batch.states = append(batch.states, v)
	}
	sort.Slice(batch.states, func(i, j int) bool { return batch.states[i].MarketID < batch.states[j].MarketID })
	reader := &Service{RPC: batch, Pool: s.Pool, Chain: s.Chain, Registry: s.Registry, Prices: s.Prices}
	// At most four simultaneous per-market jobs, independent failures do not block peers.
	slots := make(chan struct{}, 4)
	var wg sync.WaitGroup
	work := make([]State, 0, len(states))
	for _, v := range states {
		work = append(work, v)
	}
	// Cold/expired aggregates get the available RPC budget before cursor backlog.
	sort.Slice(work, func(i, j int) bool { return work[i].VolumeAt < work[j].VolumeAt })
	for _, v := range work {
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			wg.Wait()
			return
		}
		wg.Add(1)
		go func(v State) {
			defer wg.Done()
			defer func() { <-slots }()
			// Valuation uses a current state snapshot and the explorer's scoped
			// execution index. It must not wait for the recent-buy cursor.
			if time.Now().Unix()-v.VolumeAttemptAt >= 60 && (v.VolumeAt == 0 || time.Now().Unix()-v.VolumeAt >= 1200) {
				v.VolumeAttemptAt = time.Now().Unix()
				sample := v
				m, e := deployment.ReadDisplayMarket(ctx, reader.RPC, reader.Registry, v.MarketID, h.Hash)
				if e == nil {
					sample.Pool = m["poolId"].(string)
					sample.Phase = m["launchPhase"].(string)
					sample.Cursor = head
					raw, volumeErr := reader.volume(ctx, sample)
					if volumeErr == nil && reader.readState(ctx, &sample, h) == nil {
						v.VolumeVersion = 2
						v.VolumeRaw = &raw
						v.VolumeAt = time.Now().Unix()
						v.VolumeThrough = head
						v.Price = sample.Price
						v.Supply = sample.Supply
						v.StatsAt = 0
						reader.calculate(&v, time.Now())
					}
				}
				s.save(ctx, v)
			}
			// Resume a bounded backlog in the same job instead of sleeping ten
			// seconds after every empty range. Persist each completed range.
			for ranges := 0; ranges < 8; ranges++ {
				updated, err := reader.advance(ctx, v, h, head)

				if err != nil {
					if ctx.Err() == nil {
						slog.Warn("market_statistics_advance_failed", "market_id", v.MarketID, "error", err)
					}
					break
				}
				if updated.Cursor != v.Cursor || updated.Hash != v.Hash || updated.StatsAt != v.StatsAt || updated.VolumeAttemptAt != v.VolumeAttemptAt {
					s.save(ctx, updated)
				}
				if updated.Cursor == head || ctx.Err() != nil {
					break
				}
				v = updated
			}
		}(v)
	}
	wg.Wait()
}
func (s *Service) save(ctx context.Context, v State) {
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO tickergarden.market_statistics(chain_id,registry,market_id,state) VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,registry,market_id) DO UPDATE SET state=excluded.state,updated_at=clock_timestamp()`, s.Chain, s.Registry, v.MarketID, raw)
	if err != nil {
		slog.Warn("market_statistics_save_failed", "market_id", v.MarketID)
	}
	if err == nil {
		s.mu.Lock()
		s.states[v.MarketID] = v
		s.mu.Unlock()
	}
}
func (s *Service) call(ctx context.Context, target, method, args, hash string) ([]byte, error) {
	return s.RPC.CallAt(ctx, target, deployment.Hash([]byte(method))[:10]+args, hash)
}
func (s *Service) initialize(ctx context.Context, id string, h chainrpc.Header) (State, error) {
	m, err := deployment.ReadDisplayMarket(ctx, s.RPC, s.Registry, id, h.Hash)
	if err != nil {
		return State{}, err
	}
	v := State{MarketID: id, Token: m["memeToken"].(string), Curve: m["curve"].(string), Quote: m["quoteAsset"].(string), Hook: m["graduatedHook"].(string), Pool: m["poolId"].(string), Phase: m["launchPhase"].(string), Decimals: 18}
	if v.Quote != zero {
		raw, e := s.call(ctx, v.Quote, "decimals()", "", h.Hash)
		if e != nil || len(raw) != 32 {
			return v, errors.New("quote decimals unavailable")
		}
		d := new(big.Int).SetBytes(raw)
		if !d.IsUint64() || d.Uint64() < 6 || d.Uint64() > 18 {
			return v, errors.New("invalid decimals")
		}
		v.Decimals = uint8(d.Uint64())
	}
	raw, err := s.call(ctx, v.Hook, "poolManager()", "", h.Hash)
	if err != nil || len(raw) != 32 {
		return v, errors.New("pool manager unavailable")
	}
	v.Manager = "0x" + fmt.Sprintf("%x", raw[12:])
	v.Cursor, _ = h.Height()
	v.Hash = h.Hash
	v.ObservedAt = time.Now().Unix()
	if err = s.readState(ctx, &v, h); err != nil {
		return v, err
	}
	if s.Pool != nil {
		if err = s.seedHistory(ctx, &v); err != nil {
			return v, err
		}
	}
	s.seedRecentCurve(ctx, &v)
	s.calculate(&v, time.Now())
	return v, nil
}
func (s *Service) readState(ctx context.Context, v *State, h chainrpc.Header) error {
	raw, err := s.call(ctx, v.Token, "totalSupply()", "", h.Hash)
	if err != nil || len(raw) != 32 {
		return errors.New("supply unavailable")
	}
	v.Supply = new(big.Int).SetBytes(raw).String()
	if v.Phase == "0" {
		raw, err = s.call(ctx, v.Curve, "getReserves()", "", h.Hash)
		if err != nil || len(raw) != 64 {
			return errors.New("curve reserves unavailable")
		}
		q, t := new(big.Int).SetBytes(raw[:32]), new(big.Int).SetBytes(raw[32:])
		if t.Sign() == 0 {
			return errors.New("curve complete")
		}
		v.Price = new(big.Rat).SetFrac(new(big.Int).Mul(q, pow(18)), new(big.Int).Mul(t, pow(v.Decimals))).FloatString(36)
	} else {
		packed, _ := new(big.Int).SetString(v.Pool[2:]+fmt.Sprintf("%064x", 6), 16)
		slot := deployment.Hash(packed.FillBytes(make([]byte, 64)))
		raw, err = s.call(ctx, v.Manager, "extsload(bytes32)", slot[2:], h.Hash)
		if err != nil || len(raw) != 32 {
			return errors.New("pool price unavailable")
		}
		v.Price, err = Spot(new(big.Int).SetBytes(raw[12:]), v.Token < v.Quote, v.Decimals)
		if err != nil {
			return err
		}
	}
	return nil
}
func pow(d uint8) *big.Int { return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(d)), nil) }
func Spot(sqrt *big.Int, memeIs0 bool, decimals uint8) (string, error) {
	if sqrt.Sign() <= 0 || sqrt.BitLen() > 160 {
		return "", errors.New("invalid pool price")
	}
	n := new(big.Int).Mul(sqrt, sqrt)
	d := new(big.Int).Lsh(big.NewInt(1), 192)
	if !memeIs0 {
		n, d = d, n
	}
	return new(big.Rat).SetFrac(new(big.Int).Mul(n, pow(18)), new(big.Int).Mul(d, pow(decimals))).FloatString(36), nil
}
func (s *Service) calculate(v *State, now time.Time) {
	interval := int64(1200)
	if v.Metrics == nil || v.Metrics.Status != "available" {
		interval = 60
	}
	if v.StatsAt != 0 && now.Unix()-v.StatsAt < interval {
		return
	}
	metric := &readmodel.MarketMetricsReadModel{Status: "unavailable", Reason: "usd_reference_unavailable", MarketCapBasis: Basis, VolumeBasis: "EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE", AsOfTimestamp: strconv.FormatInt(now.Unix(), 10), WindowFromTimestamp: strconv.FormatInt(now.Unix()-86400, 10)}
	if s.Prices != nil {
		var found *displayprice.Reference
		for _, ref := range s.Prices.Read(now) {
			if ref.ChainID == s.Chain && ref.Token == v.Quote && ref.Status == "available" && ref.Unit == "USD_PER_WHOLE_TOKEN" && ref.BidUSD != nil && ref.AskUSD != nil && ref.AsOf != nil && ref.ExpiresAt != nil && now.Before(*ref.ExpiresAt) && !ref.AsOf.After(now) {
				if found != nil {
					found = nil
					break
				}
				copy := ref
				found = &copy
			}
		}
		if found != nil {
			bid, bok := new(big.Rat).SetString(*found.BidUSD)
			ask, aok := new(big.Rat).SetString(*found.AskUSD)
			p, pok := new(big.Rat).SetString(v.Price)
			supply, sok := new(big.Int).SetString(v.Supply, 10)
			if bok && aok && pok && sok && bid.Sign() > 0 && ask.Cmp(bid) >= 0 && p.Sign() > 0 {
				mid := new(big.Rat).Quo(new(big.Rat).Add(bid, ask), big.NewRat(2, 1))
				cap := new(big.Rat).Mul(p, mid)
				cap.Mul(cap, new(big.Rat).SetFrac(supply, pow(18)))
				a, b, stamp, source := mid.FloatString(18), cap.FloatString(18), found.AsOf.UTC().Format(time.RFC3339), found.Source
				metric.Status = "available"
				metric.Reason = ""
				metric.QuoteUSDMidpoint = &a
				metric.MarketCapUSD = &b
				metric.USDPriceAsOf = &stamp
				metric.USDPriceSource = &source
				if v.VolumeRaw != nil && now.Unix()-v.VolumeAt < 1200 {
					raw, ok := new(big.Int).SetString(*v.VolumeRaw, 10)
					if ok {
						volume := new(big.Rat).Mul(new(big.Rat).SetFrac(raw, pow(v.Decimals)), mid).FloatString(18)
						metric.Volume24hUSD = &volume
					}
				}
			}
		}
	}
	v.Metrics = metric
	v.StatsAt = now.Unix()
}

func (s *Service) PublicSnapshot() map[string]any {
	out := map[string]any{}
	for id, v := range s.Snapshot() {
		var volumeQuote *string
		if v.VolumeRaw != nil && time.Now().Unix()-v.VolumeAt < 1200 {
			if raw, ok := new(big.Int).SetString(*v.VolumeRaw, 10); ok && raw.Sign() >= 0 {
				value := new(big.Rat).SetFrac(raw, pow(v.Decimals)).FloatString(int(v.Decimals))
				volumeQuote = &value
			}
		}
		out[id] = map[string]any{"volume24hQuote": volumeQuote, "volumeObservedAt": v.VolumeAt, "marketId": id, "metrics": v.Metrics, "lastBuy": v.LastBuy, "observedAt": v.ObservedAt, "launchPhase": v.Phase}
	}
	return out
}
