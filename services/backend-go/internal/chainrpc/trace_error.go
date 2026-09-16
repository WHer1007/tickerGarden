package chainrpc

import (
	"errors"
	"fmt"
)

// rpcFailure contains numeric diagnostics only, never response text or URLs.
type rpcFailure struct {
	kind   string
	status int
	code   int
	cause  error
}

func (e *rpcFailure) Error() string {
	switch e.kind {
	case "http_status":
		return fmt.Sprintf("RPC HTTP status %d", e.status)
	case "rpc_error":
		return "RPC returned an error"
	default:
		return "RPC transport failed"
	}
}
func (e *rpcFailure) Unwrap() error { return e.cause }

// TraceError is a safe diagnostic, not evidence of why a provider rejected a
// request. Numeric codes must not be treated as permission or retry approval.
type TraceError struct {
	Kind       string `json:"kind"`
	HTTPStatus int    `json:"httpStatus,omitempty"`
	RPCCode    int    `json:"rpcCode,omitempty"`
	cause      error
}

func (e *TraceError) Error() string {
	return fmt.Sprintf("transaction execution trace unavailable: %s (http=%d rpc=%d)", e.Kind, e.HTTPStatus, e.RPCCode)
}
func (e *TraceError) Unwrap() []error { return []error{ErrTraceUnavailable, e.cause} }
func traceFailure(err error) error {
	out := &TraceError{Kind: "invalid_trace"}
	var rpc *rpcFailure
	if errors.As(err, &rpc) {
		out.Kind = rpc.kind
		out.HTTPStatus = rpc.status
		out.RPCCode = rpc.code
		out.cause = rpc.cause
	}
	return out
}
