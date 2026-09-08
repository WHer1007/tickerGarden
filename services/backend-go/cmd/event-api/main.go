package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"syscall"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/demandevents"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/eventfeed"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/projector"
	"time"
)

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) == 2 && os.Args[1] == "--describe" {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"service": "event-api", "path": "/events", "displayOnly": true, "financiallyVerified": false, "transactionSubmission": false})
	}
	raw, e := os.ReadFile(os.Getenv("TG_DEPLOYMENT_MANIFEST"))
	if e != nil {
		return errors.New("cannot read manifest")
	}
	m, e := deployment.Parse(raw)
	if e != nil {
		return e
	}
	sort.Slice(m.Contracts, func(i, j int) bool { return m.Contracts[i].Address < m.Contracts[j].Address })
	canonical, e := json.Marshal(m)
	if e != nil {
		return e
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, e := postgres.Open(ctx, os.Getenv("TG_EVENT_DATABASE_URL"), 12)
	if e != nil {
		return e
	}
	defer pool.Close()
	addr := os.Getenv("TG_EVENT_HTTP_ADDR")
	if addr == "" {
		addr = "127.0.0.1:18562"
	}
	var store eventfeed.Reader = &eventfeed.Store{Pool: pool, Chain: m.ChainID, Genesis: m.GenesisHash, Manifest: deployment.Hash(canonical), Version: projector.EventVersion}
	if os.Getenv("TG_EVENT_READ_MODE") == "on-demand" {
		start, err := strconv.ParseUint(os.Getenv("TG_EVENT_START_BLOCK"), 10, 64)
		if err != nil || start == 0 {
			return errors.New("TG_EVENT_START_BLOCK required")
		}
		rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
		if err != nil {
			return err
		}
		store, err = demandevents.New(ctx, pool, rpc, demandevents.ScopeFromManifest(m, start))
		if err != nil {
			return err
		}
	} else if os.Getenv("TG_EVENT_READ_MODE") != "" && os.Getenv("TG_EVENT_READ_MODE") != "journal" {
		return errors.New("invalid TG_EVENT_READ_MODE")
	}

	server := &http.Server{Addr: addr, Handler: eventfeed.Handler(store), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	select {
	case e := <-done:
		if !errors.Is(e, http.ErrServerClosed) {
			return e
		}
	case <-ctx.Done():
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(c)
	}
	return nil
}
