// Package settlement plans bounded conversion candidates. Planning is not an
// authorization, price attestation, chain-state check, or transaction submission.
package settlement

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

type Item struct {
	User         string `json:"user"`
	CreatorEpoch uint32 `json:"creatorEpoch"`
	MaximumMeme  string `json:"maximumMeme"`
}
type Quote struct {
	ExpectedOutput string `json:"expectedOutput"`
	QuotedAt       int64  `json:"quotedAt"`
	RequestDigest  string `json:"requestDigest"`
	ReferenceID    string `json:"referenceId"`
	MarketID       string `json:"marketId"`
	ChainID        uint64 `json:"chainId"`
}
type Input struct {
	ChainID             uint64            `json:"chainId"`
	MarketID            string            `json:"marketId"`
	Now                 int64             `json:"now"`
	PendingParticipants []Item            `json:"pendingParticipants"`
	RawExitAt           map[string]string `json:"rawExitAt"`
	PerBatchCap         string            `json:"perBatchCap"`
	TotalMeme           string            `json:"totalMeme"`
	Max32               *int              `json:"max32,omitempty"`
	Deadline            int64             `json:"deadline"`
	Quote               *Quote            `json:"quote,omitempty"`
	SlippageBps         int               `json:"slippageBps"`
}
type Request struct {
	ChainID       uint64 `json:"chainId"`
	MarketID      string `json:"marketId"`
	Items         []Item `json:"items"`
	RequestDigest string `json:"requestDigest"`
	TotalMeme     string `json:"totalMeme"`
}
type Batch struct {
	MarketID         string `json:"marketId"`
	Items            []Item `json:"items"`
	MinimumQuote     string `json:"minimumQuote"`
	Deadline         int64  `json:"deadline"`
	RequestDigest    string `json:"requestDigest"`
	QuoteReferenceID string `json:"quoteReferenceId"`
}
type Plan struct {
	MarketID         string  `json:"marketId"`
	ChainID          uint64  `json:"chainId"`
	Items            []Item  `json:"items"`
	Batches          []Batch `json:"batches"`
	RequestDigest    string  `json:"requestDigest"`
	MinimumQuote     string  `json:"minimumQuote"`
	Deadline         int64   `json:"deadline"`
	QuoteReferenceID string  `json:"quoteReferenceId"`
}

var hashPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var addressPattern = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var decimalPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)
var ErrInvalid = errors.New("invalid settlement planning input")
var ErrQuote = errors.New("non-empty settlement requires a fresh quote bound to the exact request")

const maxSafeInteger = 1<<53 - 1

func amount(s string) (*big.Int, error) {
	if len(s) > 78 || !decimalPattern.MatchString(s) {
		return nil, ErrInvalid
	}
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || n.BitLen() > 256 {
		return nil, ErrInvalid
	}
	return n, nil
}
func validAddress(s string) bool {
	return addressPattern.MatchString(s) && s != "0x0000000000000000000000000000000000000000"
}

// RequestDigest preserves the existing TypeScript SHA-256 JSON wire contract.
// Item order, users, creator epochs, and decimal amounts all affect the digest.
func RequestDigest(chainID uint64, marketID string, items []Item) (string, error) {
	if chainID == 0 || chainID > maxSafeInteger || !hashPattern.MatchString(marketID) || items == nil || len(items) > 32 {
		return "", ErrInvalid
	}
	for _, item := range items {
		if !validAddress(item.User) {
			return "", ErrInvalid
		}
		if _, e := amount(item.MaximumMeme); e != nil {
			return "", e
		}
	}
	body, e := json.Marshal(struct {
		ChainID  uint64 `json:"chainId"`
		MarketID string `json:"marketId"`
		Items    []Item `json:"items"`
	}{chainID, marketID, items})
	if e != nil {
		return "", ErrInvalid
	}
	digest := sha256.Sum256(body)
	return "0x" + hex.EncodeToString(digest[:]), nil
}

// BuildRequest filters matured raw exits before quoting. This is only a
// candidate selection from supplied data; execution must refresh these on-chain.
func BuildRequest(in Input) (Request, error) {
	if in.ChainID == 0 || in.ChainID > maxSafeInteger || !hashPattern.MatchString(in.MarketID) || in.Now < 0 || in.Now > maxSafeInteger || in.Deadline < in.Now || in.Deadline > maxSafeInteger || in.Deadline-in.Now > 300 || in.SlippageBps < 0 || in.SlippageBps > 100 || in.PendingParticipants == nil || in.RawExitAt == nil || len(in.PendingParticipants) > 4096 || len(in.RawExitAt) > 4096 {
		return Request{}, ErrInvalid
	}
	limit := 32
	if in.Max32 != nil {
		limit = *in.Max32
	}
	if limit < 1 || limit > 32 {
		return Request{}, ErrInvalid
	}
	batchCap, e := amount(in.PerBatchCap)
	if e != nil {
		return Request{}, e
	}
	totalCap, e := amount(in.TotalMeme)
	if e != nil {
		return Request{}, e
	}
	exits := map[string]*big.Int{}
	for user, value := range in.RawExitAt {
		if !validAddress(user) {
			return Request{}, ErrInvalid
		}
		n, e := amount(value)
		if e != nil {
			return Request{}, e
		}
		exits[user] = n
	}
	items := []Item{}
	seen := map[string]bool{}
	total := new(big.Int)
	now := big.NewInt(in.Now)
	for _, item := range in.PendingParticipants {
		if !validAddress(item.User) {
			return Request{}, ErrInvalid
		}
		key := item.User + ":" + strconv.FormatUint(uint64(item.CreatorEpoch), 10)
		if seen[key] {
			return Request{}, errors.New("duplicate settlement participant and creator epoch")
		}
		seen[key] = true
		n, e := amount(item.MaximumMeme)
		if e != nil {
			return Request{}, e
		}
		exit := exits[item.User]
		if n.Sign() == 0 || (exit != nil && exit.Sign() != 0 && exit.Cmp(now) <= 0) {
			continue
		}
		items = append(items, item)
		total.Add(total, n)
		if len(items) > limit || total.BitLen() > 256 || total.Cmp(batchCap) > 0 || total.Cmp(totalCap) > 0 {
			return Request{}, errors.New("settlement candidate exceeds item or amount cap")
		}
	}
	digest, e := RequestDigest(in.ChainID, in.MarketID, items)
	if e != nil {
		return Request{}, e
	}
	return Request{ChainID: in.ChainID, MarketID: in.MarketID, Items: items, RequestDigest: digest, TotalMeme: total.String()}, nil
}
func BuildPlan(in Input) (Plan, error) {
	request, e := BuildRequest(in)
	if e != nil {
		return Plan{}, e
	}
	p := Plan{MarketID: in.MarketID, ChainID: in.ChainID, Items: request.Items, Batches: []Batch{}, RequestDigest: request.RequestDigest, MinimumQuote: "0", Deadline: in.Deadline}
	if len(p.Items) == 0 {
		return p, nil
	}
	q := in.Quote
	if q == nil || q.ChainID != in.ChainID || q.MarketID != in.MarketID || q.RequestDigest != request.RequestDigest || q.QuotedAt < 0 || q.QuotedAt > in.Now || in.Now-q.QuotedAt > 30 || strings.TrimSpace(q.ReferenceID) == "" || len(q.ReferenceID) > 256 {
		return Plan{}, ErrQuote
	}
	expected, e := amount(q.ExpectedOutput)
	if e != nil || expected.Sign() == 0 {
		return Plan{}, ErrQuote
	}
	minimum := new(big.Int).Mul(expected, big.NewInt(int64(10000-in.SlippageBps)))
	minimum.Div(minimum, big.NewInt(10000))
	if minimum.Sign() == 0 {
		return Plan{}, ErrQuote
	}
	p.MinimumQuote = minimum.String()
	p.QuoteReferenceID = q.ReferenceID
	p.Batches = append(p.Batches, Batch{MarketID: p.MarketID, Items: append([]Item{}, p.Items...), MinimumQuote: p.MinimumQuote, Deadline: p.Deadline, RequestDigest: p.RequestDigest, QuoteReferenceID: p.QuoteReferenceID})
	return p, nil
}
