package content

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
)

type Repository interface {
	Save(context.Context, Bundle) error
	Get(context.Context, string) (Object, error)
}
type Handler struct {
	Store                       Repository
	Publisher                   Publisher
	PublicOrigin, AllowedOrigin string
	slots                       chan struct{}
}

func NewHandler(store Repository, public, allowed string) (*Handler, error) {
	if store == nil || !Origin(public) || !Origin(allowed) {
		return nil, errors.New("invalid content service configuration")
	}
	return &Handler{Store: store, PublicOrigin: public, AllowedOrigin: allowed, slots: make(chan struct{}, 2)}, nil
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Vary", "Origin")
	fail := func(code int, message string) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
	}
	origin := r.Header.Get("Origin")
	if origin != "" && origin != h.AllowedOrigin {
		fail(403, "origin_not_allowed")
		return
	}
	if origin == h.AllowedOrigin {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}
	if r.URL.RawQuery != "" {
		fail(400, "query_not_supported")
		return
	}
	if r.Method == "OPTIONS" {
		method := r.Header.Get("Access-Control-Request-Method")
		if origin != h.AllowedOrigin || (method != "GET" && method != "POST") {
			fail(403, "preflight_not_allowed")
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(204)
		return
	}
	if r.Method == "POST" && r.URL.Path == "/launch-metadata" {
		if origin != h.AllowedOrigin {
			fail(403, "origin_not_allowed")
			return
		}
		typ, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if e != nil || typ != "application/json" {
			fail(415, "content_type_required")
			return
		}
		select {
		case h.slots <- struct{}{}:
			defer func() { <-h.slots }()
		default:
			fail(429, "content_busy")
			return
		}
		raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxBody))
		if e != nil {
			fail(413, "body_too_large")
			return
		}
		bundle, e := Build(raw, h.PublicOrigin)
		if e != nil {
			fail(400, "invalid_request")
			return
		}
		uri := h.PublicOrigin + "/launch-metadata/" + bundle.Metadata.Key
		if h.Publisher != nil {
			// Reserve local quota and retain the original image before external storage spends.
			if e = h.Store.Save(r.Context(), bundle); e != nil {
				if errors.Is(e, ErrQuota) {
					fail(429, "content_quota_exhausted")
				} else {
					fail(503, "content_store_unavailable")
				}
				return
			}
			bundle, uri, e = h.Publisher.Publish(r.Context(), bundle)
			if e != nil {
				fail(503, "metadata_publication_failed")
				return
			}
		}
		if e = h.Store.Save(r.Context(), bundle); e != nil {
			if errors.Is(e, ErrQuota) {
				fail(429, "content_quota_exhausted")
			} else {
				fail(503, "content_store_unavailable")
			}
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(201)
		_ = json.NewEncoder(w).Encode(map[string]any{"metadataURI": uri, "metadata": json.RawMessage(bundle.Metadata.Data)})
		return
	}
	if r.Method != "GET" {
		w.Header().Set("Allow", "GET, POST, OPTIONS")
		fail(405, "method_not_allowed")
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/launch-metadata/") {
		fail(404, "not_found")
		return
	}
	key := strings.TrimPrefix(r.URL.Path, "/launch-metadata/")
	if !keyRE.MatchString(key) {
		fail(404, "not_found")
		return
	}
	o, e := h.Store.Get(r.Context(), key)
	if e != nil {
		if errors.Is(e, ErrMissing) {
			fail(404, "not_found")
		} else {
			fail(503, "content_store_unavailable")
		}
		return
	}
	ext := strings.Split(key, ".")[1]
	typ := map[string]string{"json": "application/json; charset=utf-8", "png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}[ext]
	w.Header().Set("Content-Type", typ)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", `"`+key+`"`)
	w.WriteHeader(200)
	_, _ = w.Write(o.Data)
}
