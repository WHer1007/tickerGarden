package chainrpc

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestParallelReadWavesReuseConnections(t *testing.T) {
	const waves = 8
	gates := make([]chan struct{}, waves)
	for i := range gates {
		gates[i] = make(chan struct{})
	}
	var requests, connections atomic.Int32
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := int(requests.Add(1)) - 1
		gate := gates[n/4]
		if n%4 == 3 {
			close(gate)
		}
		select {
		case <-gate:
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"result":"0x00"}`)
	}))
	server.Config.ConnState = func(_ net.Conn, s http.ConnState) {
		if s == http.StateNew {
			connections.Add(1)
		}
	}
	server.Start()
	defer server.Close()
	client, err := New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	addresses := []string{fmt.Sprintf("0x%040x", 1), fmt.Sprintf("0x%040x", 2), fmt.Sprintf("0x%040x", 3), fmt.Sprintf("0x%040x", 4)}
	for range waves {
		if _, err = client.CodesAt(ctx, addresses, fmt.Sprintf("0x%064x", 1)); err != nil {
			t.Fatal(err)
		}
	}
	if got := connections.Load(); got != 4 {
		t.Fatalf("opened %d connections for repeated four-request waves; want 4 reused connections", got)
	}
}
