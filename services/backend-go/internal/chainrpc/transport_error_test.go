package chainrpc

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"syscall"
	"testing"
)

func TestTransportErrorsPreserveSafeCause(t *testing.T) {
	secret := &url.Error{Op: "Post", URL: "https://private:secret@example.test/token", Err: syscall.EADDRNOTAVAIL}
	got := transportError(context.Background(), secret)
	if !strings.Contains(got.Error(), "syscall errno") || strings.Contains(got.Error(), "secret") || strings.Contains(got.Error(), "example.test") {
		t.Fatal(got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(transportError(ctx, secret), context.Canceled) {
		t.Fatal("cancellation lost")
	}
}
