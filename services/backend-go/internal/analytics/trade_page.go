package analytics

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
)

var ErrTradeCursor = errors.New("invalid trade cursor")
var ErrTradePageChanged = errors.New("trade page changed; restart pagination")

type TradePage struct {
	MarketID      string          `json:"marketId"`
	MemeAsset     string          `json:"memeAsset"`
	QuoteAsset    string          `json:"quoteAsset"`
	QuoteDecimals uint8           `json:"quoteDecimals"`
	Coverage      RangeCoverage   `json:"coverage"`
	Revision      string          `json:"revision"`
	Items         []TradeActivity `json:"items"`
	NextCursor    *string         `json:"nextCursor"`
}
type tradeCursor struct {
	Version  int    `json:"version"`
	Chain    uint64 `json:"chain"`
	Market   string `json:"market"`
	From     uint64 `json:"from"`
	To       uint64 `json:"to"`
	Limit    int    `json:"limit"`
	Revision string `json:"revision"`
	After    string `json:"after"`
}

// PageTrades binds pagination to the complete verified result, including its
// coverage checkpoint. It does not preserve obsolete canonical snapshots.
func PageTrades(chain uint64, data MarketTrades, limit int, cursor string) (TradePage, error) {
	if limit < 1 || limit > 100 || len(cursor) > 2048 {
		return TradePage{}, ErrTradeCursor
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return TradePage{}, err
	}
	digest := sha256.Sum256(raw)
	revision := "sha256:" + hex.EncodeToString(digest[:])
	start := 0
	if cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || base64.RawURLEncoding.EncodeToString(raw) != cursor {
			return TradePage{}, ErrTradeCursor
		}
		var c tradeCursor
		d := json.NewDecoder(bytes.NewReader(raw))
		d.DisallowUnknownFields()
		if d.Decode(&c) != nil || d.Decode(new(any)) != io.EOF {
			return TradePage{}, ErrTradeCursor
		}
		canonical, _ := json.Marshal(c)
		if !bytes.Equal(canonical, raw) || c.Version != 1 || c.Chain != chain || c.Market != data.MarketID || c.From != data.Coverage.From || c.To != data.Coverage.To || c.Limit != limit {
			return TradePage{}, ErrTradeCursor
		}
		if c.Revision != revision {
			return TradePage{}, ErrTradePageChanged
		}
		found := false
		for i, item := range data.Items {
			if item.Source.EventKey == c.After {
				start = i + 1
				found = true
				break
			}
		}
		if !found || start >= len(data.Items) {
			return TradePage{}, ErrTradeCursor
		}
	}
	end := start + limit
	if end > len(data.Items) {
		end = len(data.Items)
	}
	out := TradePage{MarketID: data.MarketID, MemeAsset: data.MemeAsset, QuoteAsset: data.QuoteAsset, QuoteDecimals: data.QuoteDecimals, Coverage: data.Coverage, Revision: revision, Items: append([]TradeActivity{}, data.Items[start:end]...)}
	if end < len(data.Items) {
		c := tradeCursor{Version: 1, Chain: chain, Market: data.MarketID, From: data.Coverage.From, To: data.Coverage.To, Limit: limit, Revision: revision, After: data.Items[end-1].Source.EventKey}
		raw, _ := json.Marshal(c)
		next := base64.RawURLEncoding.EncodeToString(raw)
		out.NextCursor = &next
	}
	return out, nil
}
