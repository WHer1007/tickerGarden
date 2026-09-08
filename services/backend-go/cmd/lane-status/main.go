package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"tickergarden/backend/internal/lanestatus"
)

func main() {
	d := flag.Bool("describe", false, "")
	o := flag.Bool("once", false, "")
	flag.Parse()
	if *d {
		fmt.Println(`{"schemaVersion":"lane-status-v1","scope":"event_activity","coverageOnly":true}`)
		return
	}
	if !*o {
		die("--once required")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	chain, e := env("TG_CHAIN_ID")
	if e != nil {
		die("invalid configuration")
	}
	start, e := env("TG_ACTIVITY_START_BLOCK", "TG_CHAIN_START_BLOCK", "TG_START_BLOCK")
	if e != nil {
		die("invalid configuration")
	}
	dsn, mh, v := os.Getenv("TG_STATUS_DATABASE_URL"), os.Getenv("TG_MANIFEST_HASH"), os.Getenv("TG_PROJECTOR_VERSION")
	if dsn == "" || mh == "" || v == "" {
		die("required configuration missing")
	}
	pc, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		die("invalid database configuration")
	}
	pc.MaxConns = 1
	p, e := pgxpool.NewWithConfig(ctx, pc)
	if e != nil {
		die("database unavailable")
	}
	defer p.Close()
	s, e := lanestatus.Load(ctx, p, lanestatus.Config{ChainID: chain, StartBlock: start, ManifestHash: mh, ProjectorVersion: v})
	if e != nil {
		die("lane status unavailable")
	}
	if e = json.NewEncoder(os.Stdout).Encode(s); e != nil {
		die("output unavailable")
	}
	if !s.Available {
		os.Exit(2)
	}
}
func env(ks ...string) (int64, error) {
	for _, k := range ks {
		if v := os.Getenv(k); v != "" {
			return strconv.ParseInt(v, 10, 64)
		}
	}
	return 0, fmt.Errorf("missing")
}
func die(s string) { fmt.Fprintln(os.Stderr, "lane-status:", s); os.Exit(1) }
