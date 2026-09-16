package app

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestServeClosesListenerOnCancellation(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "alive") }), ReadHeaderTimeout: time.Second}
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, server, listener, time.Second) }()
	client := &http.Client{Timeout: time.Second}
	response, err := client.Get("http://" + listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown did not complete")
	}
	if response, err := client.Get("http://" + listener.Addr().String()); err == nil {
		response.Body.Close()
		t.Fatal("listener still accepts requests")
	}
}

func TestTransactionAPIRequiresDatabase(t *testing.T) {
	t.Setenv("TG_DATABASE_URL", "")
	t.Setenv("TG_DISPLAY_PRICES_CONFIG", "")
	t.Setenv("TG_TRANSACTION_STATUS_MANIFEST", "/not-read-without-database")
	if err := RunAPI(context.Background()); err == nil || err.Error() != "transaction API requires TG_DATABASE_URL" {
		t.Fatal(err)
	}
}

func TestActivityAPIRequiresDatabase(t *testing.T) {
	t.Setenv("TG_USER_ACTIVITY_MANIFEST", "unused.json")
	t.Setenv("TG_DATABASE_URL", "")
	if err := RunAPI(context.Background()); err == nil || err.Error() != "activity API requires TG_DATABASE_URL" {
		t.Fatal(err)
	}
}
