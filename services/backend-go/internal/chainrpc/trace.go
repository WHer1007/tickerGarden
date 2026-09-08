package chainrpc

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"time"
)

// CallTrace is execution evidence reported by the configured RPC. It is not a
// consensus proof. The caller must bind the root to a signed transaction and
// recheck the canonical receipt block before using it for reconciliation.
type CallTrace struct {
	Type   string      `json:"type"`
	From   string      `json:"from"`
	To     string      `json:"to"`
	Input  string      `json:"input"`
	Output string      `json:"output"`
	Value  string      `json:"value,omitempty"`
	Error  string      `json:"error,omitempty"`
	Calls  []CallTrace `json:"calls,omitempty"`
}

var ErrTraceUnavailable = errors.New("transaction execution trace unavailable or inconsistent")

// TransactionCallTrace requests one callTracer result with no retry or fallback.
// Trace-capable archival RPC access is an explicit operational prerequisite.
func (c *Client) TransactionCallTrace(ctx context.Context, hash string) (CallTrace, error) {
	if !hashPattern.MatchString(hash) {
		return CallTrace{}, traceFailure(nil)
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	var raw json.RawMessage
	if err := c.call(ctx, "debug_traceTransaction", []any{hash, map[string]any{"tracer": "callTracer", "timeout": "15s", "tracerConfig": map[string]any{"onlyTopCall": false, "withLog": false}}}, &raw); err != nil {
		return CallTrace{}, traceFailure(err)
	}
	if len(raw) > 1<<20 {
		return CallTrace{}, traceFailure(nil)
	}
	// Check nesting before decoding a recursive structure. This also bounds
	// malicious JSON that would otherwise create a very deep CallTrace value.
	depth := 0
	inString, escaped := false, false
	for _, b := range raw {
		if inString {
			if escaped {
				escaped = false
			} else if b == '\\' {
				escaped = true
			} else if b == '"' {
				inString = false
			}
			continue
		}
		switch b {
		case '"':
			inString = true
		case '{', '[':
			depth++
			if depth > 130 {
				return CallTrace{}, traceFailure(nil)
			}
		case '}', ']':
			depth--
		}
	}
	var result CallTrace
	if json.Unmarshal(raw, &result) != nil || (result.Type != "CALL" && result.Type != "CREATE") {
		return CallTrace{}, traceFailure(nil)
	}
	nodes, total := 0, 0
	if !validTrace(result, 0, &nodes, &total) {
		return CallTrace{}, traceFailure(nil)
	}
	return result, nil
}
func validTrace(t CallTrace, depth int, nodes, total *int) bool {
	*nodes++
	if depth > 64 || *nodes > 4096 || !addressPattern.MatchString(t.From) || !addressPattern.MatchString(t.To) || !dataPattern.MatchString(t.Input) || len(t.Input)%2 != 0 {
		return false
	}
	switch t.Type {
	case "CALL", "STATICCALL", "DELEGATECALL", "CALLCODE", "CREATE", "CREATE2":
	default:
		return false
	}
	// Geth omits empty output, including successful void calls. Consumers that
	// require a return value must validate its exact ABI length.
	if t.Output != "" && (!dataPattern.MatchString(t.Output) || len(t.Output)%2 != 0) {
		return false
	}
	if t.Value != "" {
		if _, err := parseTraceValue(t.Value); err != nil {
			return false
		}
	}
	*total += len(t.Input) + len(t.Output) + len(t.Error)
	if len(t.Input) > 131074 || len(t.Output) > 131074 || len(t.Error) > 4096 || *total > 1<<20 {
		return false
	}
	for _, child := range t.Calls {
		if !validTrace(child, depth+1, nodes, total) {
			return false
		}
	}
	return true
}

func parseTraceValue(raw string) (*big.Int, error) {
	if !strings.HasPrefix(raw, "0x") || len(raw) < 3 || len(raw) > 66 || (len(raw) > 3 && raw[2] == '0') {
		return nil, ErrTraceUnavailable
	}
	for _, c := range raw[2:] {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return nil, ErrTraceUnavailable
		}
	}
	n, ok := new(big.Int).SetString(raw[2:], 16)
	if !ok {
		return nil, ErrTraceUnavailable
	}
	return n, nil
}

// ValidateCallTrace reapplies transport bounds to stored diagnostic evidence.
func ValidateCallTrace(trace CallTrace) error {
	nodes, total := 0, 0
	if !validTrace(trace, 0, &nodes, &total) {
		return ErrTraceUnavailable
	}
	raw, e := json.Marshal(trace)
	if e != nil || len(raw) > 1<<20 {
		return ErrTraceUnavailable
	}
	return nil
}
