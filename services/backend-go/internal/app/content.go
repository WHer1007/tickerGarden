package app

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"tickergarden/backend/internal/content"
	"tickergarden/backend/internal/postgres"
)

// RunContent serves only metadata, keeping uploads and write credentials separate
// from the read API. The same PostgreSQL backup contains JSON and media bytes.
func RunContent(ctx context.Context) error {
	dsn := os.Getenv("TG_CONTENT_DATABASE_URL")
	if dsn == "" {
		return errors.New("TG_CONTENT_DATABASE_URL is required")
	}
	pool, e := postgres.Open(ctx, dsn, 4)
	if e != nil {
		return errors.New("cannot configure content database")
	}
	defer pool.Close()
	handler, e := content.NewHandler(content.Store{Pool: pool}, os.Getenv("TG_CONTENT_PUBLIC_ORIGIN"), os.Getenv("TG_CONTENT_WEB_ORIGIN"))
	if e != nil {
		return e
	}
	if os.Getenv("TG_CONTENT_STORAGE") == "ipfs" {
		jwt := os.Getenv("PINATA_JWT")
		if jwt == "" {
			return errors.New("PINATA_JWT is required for IPFS publication")
		}
		publisher := content.NewPinata(jwt)
		publisher.GroupID = os.Getenv("PINATA_GROUP_ID")
		publisher.CacheDir = os.Getenv("TG_CONTENT_IPFS_CACHE_DIR")
		if publisher.CacheDir == "" {
			publisher.CacheDir = ".state/ipfs-publications"
		}
		if e := os.MkdirAll(publisher.CacheDir, 0700); e != nil {
			return errors.New("cannot configure IPFS publication cache")
		}
		handler.Publisher = publisher
	} else if mode := os.Getenv("TG_CONTENT_STORAGE"); mode != "" && mode != "http" {
		return errors.New("TG_CONTENT_STORAGE must be http or ipfs")
	}
	addr := os.Getenv("TG_CONTENT_HTTP_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8791"
	}
	mux := http.NewServeMux()
	chainID, err := strconv.ParseUint(os.Getenv("TG_CHAIN_ID"), 10, 64)
	if err != nil || chainID == 0 {
		return errors.New("TG_CHAIN_ID is required for upload authorization")
	}
	secured := (content.UploadAuthorizer{Pool: pool, Origin: os.Getenv("TG_CONTENT_WEB_ORIGIN"), ChainID: chainID}).Wrap(handler)
	mux.Handle("/launch-metadata", secured)
	mux.Handle("/launch-metadata/", secured)
	mux.HandleFunc("GET /livez", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		c, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		var ready bool
		if e := pool.QueryRow(c, `SELECT EXISTS(SELECT 1 FROM tickergarden.content_quota WHERE id) AND to_regclass('tickergarden.content_objects') IS NOT NULL AND to_regclass('tickergarden.content_upload_challenges') IS NOT NULL AND to_regclass('tickergarden.content_upload_limits') IS NOT NULL`).Scan(&ready); e != nil || !ready {
			http.Error(w, "not ready", 503)
			return
		}
		w.WriteHeader(200)
	})
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: time.Minute, MaxHeaderBytes: 16 << 10, BaseContext: func(net.Listener) context.Context { return ctx }}
	listener, e := net.Listen("tcp", addr)
	if e != nil {
		return errors.New("cannot bind content service")
	}
	slog.Info("content_started", "address", listener.Addr().String())
	return Serve(ctx, server, listener, 10*time.Second)
}
