package displayprice

import (
	"context"
	"errors"
	"net"
)

// Only fixed categories are exposed; response bodies, URLs and transport errors
// can contain sensitive infrastructure details and must not enter public output.
type upstreamFailure string

func (e upstreamFailure) Error() string { return string(e) }
func requestFailure(ctx context.Context, err error) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return upstreamFailure("budget_exhausted")
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return upstreamFailure("cancelled")
	}
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		return upstreamFailure("timeout")
	}
	return upstreamFailure("transport_error")
}
func failureReason(stage string, err error) string {
	var failure upstreamFailure
	if errors.As(err, &failure) {
		return stage + "_" + string(failure)
	}
	return stage + "_invalid_response"
}
