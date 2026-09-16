package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/readmodel"
	"time"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if e := run(ctx, os.Args[1:], os.Stdout); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run(parent context.Context, args []string, out io.Writer) error {
	if err := parent.Err(); err != nil {
		return err
	}
	if len(args) == 2 && args[0] == "--watch" {
		return watch(parent, args[1], out, 5*time.Second, publish)
	}
	if len(args) != 2 {
		return errors.New("usage: publish-snapshot FILE PRODUCER_VERIFIED_AT_RFC3339 | --watch ENVELOPE_JSON")
	}
	at, e := time.Parse(time.RFC3339Nano, args[1])
	if e != nil {
		return errors.New("invalid producer verification timestamp")
	}

	f, e := os.Open(args[0])
	if e != nil {
		return errors.New("cannot open snapshot file")
	}
	defer f.Close()
	data, e := io.ReadAll(io.LimitReader(f, readmodel.MaxSnapshotBytes+1))
	if e != nil {
		return errors.New("cannot read snapshot file")
	}
	return publish(parent, data, at, out)
}

func publish(parent context.Context, data []byte, at time.Time, out io.Writer) error {
	if at.Before(time.Now().Add(-readmodel.MaxAge)) || at.After(time.Now().Add(5*time.Second)) {
		return errors.New("producer verification timestamp is stale or in the future")
	}
	for _, name := range []string{"TG_PUBLISH_ACCOUNTS", "TG_PUBLISH_IDENTITIES"} {
		if v := os.Getenv(name); v != "" && v != "true" && v != "false" {
			return fmt.Errorf("%s must be true or false", name)
		}
	}
	cfg, e := config.Load()
	if e != nil {
		return e
	}
	dsn := os.Getenv("TG_PUBLISHER_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_PUBLISHER_DATABASE_URL is required")
	}
	if _, e = readmodel.Parse(data, cfg.ChainID); e != nil {
		return e
	}
	if e = parent.Err(); e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(parent, time.Minute)
	defer cancel()
	pool, e := postgres.Open(ctx, dsn, cfg.DBMaxConns)
	if e != nil {
		return e
	}
	defer pool.Close()
	store := readmodel.Store{Pool: pool, ChainID: cfg.ChainID}
	if v := os.Getenv("TG_PUBLISH_ACCOUNTS"); v == "true" {
		data, e = enrichAccounts(ctx, pool, cfg.ChainID, data)
		if e != nil {
			return e
		}
	} else if v != "" && v != "false" {
		return errors.New("TG_PUBLISH_ACCOUNTS must be true or false")
	}
	if os.Getenv("TG_PUBLISH_IDENTITIES") == "true" {
		data, e = store.EnrichIdentities(ctx, data)
		if e != nil {
			return e
		}
	} else if v := os.Getenv("TG_PUBLISH_IDENTITIES"); v != "" && v != "false" {
		return errors.New("TG_PUBLISH_IDENTITIES must be true or false")
	}
	if e = store.Publish(ctx, data, at); e != nil {
		return e
	}
	_, e = fmt.Fprintln(out, `{"status":"published","transactionSubmission":false}`)
	return e
}
