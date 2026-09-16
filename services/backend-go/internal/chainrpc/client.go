// Package chainrpc implements a bounded Ethereum JSON-RPC client.
package chainrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"syscall"
	"time"
)

var hashPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)
var addressPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
var dataPattern = regexp.MustCompile(`^0x(?:[0-9a-fA-F]{2})*$`)

type Header struct {
	Timestamp  string `json:"timestamp"`
	Number     string `json:"number"`
	Hash       string `json:"hash"`
	ParentHash string `json:"parentHash"`
}
type Log struct {
	Address          string   `json:"address"`
	Topics           []string `json:"topics"`
	Data             string   `json:"data"`
	BlockNumber      string   `json:"blockNumber"`
	BlockHash        string   `json:"blockHash"`
	TransactionHash  string   `json:"transactionHash"`
	TransactionIndex string   `json:"transactionIndex"`
	LogIndex         string   `json:"logIndex"`
	Removed          bool     `json:"removed"`
}
type Client struct {
	endpoint string
	http     *http.Client
}

// Retain all four parallel state-read connections between batches. The default
// transport retains only two per host, causing connection churn on long replays.
// Share the pool across clients, while preserving the standard TLS/proxy policy.
var rpcTransport = func() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = 8
	return transport
}()

func New(endpoint string) (*Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Fragment != "" {
		return nil, errors.New("invalid RPC endpoint")
	}
	return &Client{endpoint: endpoint, http: &http.Client{Transport: rpcTransport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("RPC redirects disabled") }}}, nil
}
func Quantity(s string) (uint64, error) {
	if len(s) < 3 || s[:2] != "0x" || (len(s) > 3 && s[2] == '0') {
		return 0, errors.New("invalid RPC quantity")
	}
	n, e := strconv.ParseUint(s[2:], 16, 64)
	if e != nil || n > uint64(1<<63-1) {
		return 0, errors.New("RPC quantity exceeds supported range")
	}
	return n, nil
}
func (h Header) Time() (uint64, error)   { return Quantity(h.Timestamp) }
func (h Header) Height() (uint64, error) { return Quantity(h.Number) }
func (c *Client) call(ctx context.Context, method string, params any, out any) error {
	return c.callResult(ctx, method, params, out, false)
}

func (c *Client) callResult(ctx context.Context, method string, params any, out any, allowNull bool) error {
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return errors.New("cannot construct RPC request")
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return &rpcFailure{kind: "transport", cause: transportError(ctx, err)}
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return &rpcFailure{kind: "http_status", status: res.StatusCode}
	}
	const max = 16 << 20
	data, err := io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil || len(data) > max {
		return errors.New("RPC response unreadable or exceeds 16 MiB")
	}
	var envelope struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      int             `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   json.RawMessage `json:"error"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.JSONRPC != "2.0" || envelope.ID != 1 {
		return errors.New("invalid RPC envelope")
	}
	if len(envelope.Error) > 0 && string(envelope.Error) != "null" {
		var detail struct {
			Code int `json:"code"`
		}
		_ = json.Unmarshal(envelope.Error, &detail)
		return &rpcFailure{kind: "rpc_error", code: detail.Code}
	}
	if len(envelope.Result) == 0 || (!allowNull && string(envelope.Result) == "null") {
		return errors.New("RPC result unavailable")
	}
	if json.Unmarshal(envelope.Result, out) != nil {
		return errors.New("invalid RPC result")
	}
	return nil
}
func (c *Client) ChainID(ctx context.Context) (uint64, error) {
	var s string
	if err := c.call(ctx, "eth_chainId", []any{}, &s); err != nil {
		return 0, err
	}
	return Quantity(s)
}
func (c *Client) Header(ctx context.Context, tag string) (Header, error) {
	var h Header
	err := c.call(ctx, "eth_getBlockByNumber", []any{tag, false}, &h)
	if err != nil {
		return h, err
	}
	if _, err = h.Height(); err != nil || !hashPattern.MatchString(h.Hash) || !hashPattern.MatchString(h.ParentHash) {
		return h, errors.New("invalid RPC block header")
	}
	if _, err = h.Time(); err != nil {
		return h, errors.New("invalid RPC block timestamp")
	}
	if tag != "latest" && tag != "finalized" && h.Number != tag {
		return h, errors.New("RPC returned wrong block height")
	}
	return h, nil
}
func (c *Client) filterLogs(ctx context.Context, h Header) ([]Log, error) {
	var logs []Log
	if err := c.call(ctx, "eth_getLogs", []any{map[string]string{"blockHash": h.Hash}}, &logs); err != nil {
		return nil, err
	}
	if logs == nil {
		return nil, errors.New("RPC logs must be an array")
	}
	seen := map[uint64]bool{}
	for _, l := range logs {
		idx, e := Quantity(l.LogIndex)
		_, te := Quantity(l.TransactionIndex)
		if e != nil || te != nil || seen[idx] || l.Removed || l.BlockHash != h.Hash || l.BlockNumber != h.Number || !hashPattern.MatchString(l.TransactionHash) || !addressPattern.MatchString(l.Address) || !dataPattern.MatchString(l.Data) || l.Topics == nil || len(l.Topics) > 4 {
			return nil, errors.New("invalid or duplicate RPC log")
		}
		seen[idx] = true
		for _, topic := range l.Topics {
			if !hashPattern.MatchString(topic) {
				return nil, errors.New("invalid log topic")
			}
		}
	}
	return logs, nil
}

// Report actionable failure classes without exposing RPC URLs or credentials.
func transportError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return fmt.Errorf("RPC transport failed: %w", ctx.Err())
	}
	var errno syscall.Errno
	if errors.As(err, &errno) {
		return fmt.Errorf("RPC transport failed: syscall errno %d", errno)
	}
	var network net.Error
	if errors.As(err, &network) && network.Timeout() {
		return errors.New("RPC transport failed: timeout")
	}
	return errors.New("RPC transport failed")
}
