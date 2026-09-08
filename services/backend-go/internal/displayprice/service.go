package displayprice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"sync"
	"time"
)

// MaxTargets bounds the configured release catalog and API response.
const MaxTargets = 64

type Service struct {
	provider Provider
	targets  []Target
	mu       sync.RWMutex
	values   []Reference
}

func Load(path string, chain uint64) (*Service, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, errData
	}
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, 65537))
	if e != nil || len(raw) > 65536 {
		return nil, errData
	}
	var targets []Target
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&targets) != nil {
		return nil, errData
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, errData
	}
	return New(targets, chain, NewProvider())
}
func New(targets []Target, chain uint64, p Provider) (*Service, error) {
	if len(targets) == 0 || len(targets) > MaxTargets {
		return nil, errors.New("display prices require 1 to 64 configured targets")
	}
	seen := map[string]bool{}
	symbols := map[string]bool{}
	uids := map[string]bool{}
	for _, t := range targets {
		if !ValidTarget(t) || t.ChainID != chain || seen[t.Token] || symbols[t.Symbol] || uids[t.AssetUID] {
			return nil, errData
		}
		seen[t.Token] = true
		symbols[t.Symbol] = true
		uids[t.AssetUID] = true
	}
	s := &Service{provider: p, targets: append([]Target{}, targets...), values: []Reference{}}
	for _, t := range targets {
		s.values = append(s.values, missing(t, time.Now().UTC(), "not_refreshed"))
	}
	return s, nil
}

// Read never performs network I/O. Staleness is evaluated at response time.
func (s *Service) Read(now time.Time) []Reference {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Reference, len(s.values))
	for i, r := range s.values {
		out[i] = expire(r, now)
	}
	return out
}
func (s *Service) refresh(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	results := make([]Reference, len(s.targets))
	shared := &batch{bulk: len(s.targets) > 1}
	var wg sync.WaitGroup
	limit := make(chan struct{}, 4)
	for i, t := range s.targets {
		wg.Add(1)
		go func(i int, t Target) {
			defer wg.Done()
			select {
			case limit <- struct{}{}:
				defer func() { <-limit }()
			case <-ctx.Done():
				results[i] = missing(t, time.Now().UTC(), failureReason("refresh", requestFailure(ctx, ctx.Err())))
				return
			}
			results[i] = s.provider.fetch(ctx, t, time.Now().UTC(), shared)
		}(i, t)
	}
	wg.Wait()
	s.mu.Lock()
	s.values = results
	s.mu.Unlock()
}
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		s.refresh(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
