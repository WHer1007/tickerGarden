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

var ErrHolderCursor = errors.New("invalid holder cursor")
var ErrHolderPageChanged = errors.New("holder page changed; restart pagination")

type HolderPage struct {
	MarketHolders
	Revision   string  `json:"revision"`
	NextCursor *string `json:"nextCursor"`
}
type holderCursor struct {
	Version  int    `json:"version"`
	Chain    uint64 `json:"chain"`
	Market   string `json:"market"`
	Limit    int    `json:"limit"`
	Revision string `json:"revision"`
	After    string `json:"after"`
}

// PageHolders binds pagination to the complete verified result, including its
// coverage checkpoint. It does not preserve obsolete canonical snapshots.
func PageHolders(chain uint64, data MarketHolders, limit int, cursor string) (HolderPage, error) {
	if limit < 1 || limit > 100 || len(cursor) > 2048 {
		return HolderPage{}, ErrHolderCursor
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return HolderPage{}, err
	}
	digest := sha256.Sum256(raw)
	revision := "sha256:" + hex.EncodeToString(digest[:])
	start := 0
	if cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || base64.RawURLEncoding.EncodeToString(raw) != cursor {
			return HolderPage{}, ErrHolderCursor
		}
		var c holderCursor
		d := json.NewDecoder(bytes.NewReader(raw))
		d.DisallowUnknownFields()
		if d.Decode(&c) != nil || d.Decode(new(any)) != io.EOF {
			return HolderPage{}, ErrHolderCursor
		}
		canonical, _ := json.Marshal(c)
		if !bytes.Equal(canonical, raw) || c.Version != 1 || c.Chain != chain || c.Market != data.MarketID || c.Limit != limit {
			return HolderPage{}, ErrHolderCursor
		}
		if c.Revision != revision {
			return HolderPage{}, ErrHolderPageChanged
		}
		found := false
		for i, item := range data.Balances {
			if item.Account == c.After {
				start = i + 1
				found = true
				break
			}
		}
		if !found || start >= len(data.Balances) {
			return HolderPage{}, ErrHolderCursor
		}
	}
	end := start + limit
	if end > len(data.Balances) {
		end = len(data.Balances)
	}
	out := HolderPage{MarketHolders: data, Revision: revision}
	out.HolderBalances.Balances = append([]HolderBalance{}, data.Balances[start:end]...)
	if end < len(data.Balances) {
		c := holderCursor{Version: 1, Chain: chain, Market: data.MarketID, Limit: limit, Revision: revision, After: data.Balances[end-1].Account}
		raw, _ := json.Marshal(c)
		next := base64.RawURLEncoding.EncodeToString(raw)
		out.NextCursor = &next
	}
	return out, nil
}
