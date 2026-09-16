package marketstats

import (
	"encoding/json"
	"math/big"
	"net/http"
	"time"
)

// Current display valuations, including testnet pool quotes. Never settlement prices.
func (s *Service) PriceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		w.WriteHeader(405)
		return
	}
	now := time.Now()
	prices := map[string]string{}
	expires := map[string]int64{}
	if s.Prices != nil {
		for _, ref := range s.Prices.Read(now) {
			if ref.ChainID != s.Chain || ref.Status != "available" || ref.BidUSD == nil || ref.AskUSD == nil || ref.ExpiresAt == nil || !now.Before(*ref.ExpiresAt) {
				continue
			}
			bid, a := new(big.Rat).SetString(*ref.BidUSD)
			ask, b := new(big.Rat).SetString(*ref.AskUSD)
			if !a || !b || bid.Sign() <= 0 || ask.Cmp(bid) < 0 {
				continue
			}
			prices[ref.Token] = new(big.Rat).Quo(new(big.Rat).Add(bid, ask), big.NewRat(2, 1)).FloatString(18)
			expires[ref.Token] = ref.ExpiresAt.Unix()
		}
	}
	for _, v := range s.Snapshot() {
		if now.Unix()-v.StatsAt > 1200 || v.StatsAt == 0 {
			continue
		}
		p, ok := new(big.Rat).SetString(v.Price)
		q, valid := new(big.Rat).SetString(prices[v.Quote])
		if !ok || !valid || p.Sign() <= 0 {
			continue
		}
		prices[v.Token] = new(big.Rat).Mul(p, q).FloatString(18)
		expires[v.Token] = expires[v.Quote]
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{"chainId": s.Chain, "displayOnly": true, "basis": "CURRENT_POOL_SPOT_USD", "prices": prices, "expiresAt": expires})
}
