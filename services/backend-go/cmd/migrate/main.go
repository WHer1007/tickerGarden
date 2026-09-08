package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/migration"
)

func run() error {
	if len(os.Args) != 2 || (os.Args[1] != "up" && os.Args[1] != "status") {
		return errors.New("usage: migrate up|status (requires TG_MIGRATION_DATABASE_URL)")
	}
	dsn := os.Getenv("TG_MIGRATION_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_MIGRATION_DATABASE_URL is required")
	}
	cfg, err := config.Parse(func(key string) string {
		if key == "TG_DATABASE_URL" {
			return dsn
		}
		return ""
	})
	if err != nil {
		return errors.New("invalid migration database configuration")
	}
	connection, err := pgx.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return errors.New("invalid migration database configuration")
	}
	connection.ConnectTimeout = 5 * time.Second
	db := stdlib.OpenDB(*connection)
	defer db.Close()
	db.SetMaxOpenConns(1)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return errors.New("migration database is unreachable")
	}
	provider, err := migration.New(db)
	if err != nil {
		return errors.New("cannot initialize migration provider")
	}
	if os.Args[1] == "up" {
		results, err := provider.Up(ctx)
		if err != nil {
			return errors.New("migration failed; inspect database state before retrying")
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "applied", "migrations": len(results)})
	}
	results, err := provider.Status(ctx)
	if err != nil {
		return errors.New("cannot read migration status")
	}
	return json.NewEncoder(os.Stdout).Encode(results)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}
