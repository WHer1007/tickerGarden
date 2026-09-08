package integration

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/content"
)

func testContent(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	var img bytes.Buffer
	if e := png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 2, 2))); e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(map[string]any{"name": "Garden", "symbol": "GARDEN", "image": "data:image/png;base64," + base64.StdEncoding.EncodeToString(img.Bytes())})
	b, e := content.Build(raw, "http://localhost:8791")
	if e != nil {
		t.Fatal(e)
	}
	store := content.Store{Pool: pool}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.content_quota SET max_bytes=$1`, len(b.Metadata.Data)+len(b.Image.Data)-1); e != nil {
		t.Fatal(e)
	}
	if e = store.Save(ctx, b); !errors.Is(e, content.ErrQuota) {
		t.Fatal("capacity not enforced", e)
	}
	var count, used int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.content_objects`).Scan(&count); e != nil || count != 0 {
		t.Fatal("partial bundle survived", count, e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.content_quota SET max_bytes=1073741824`); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- store.Save(ctx, b) }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	if e = pool.QueryRow(ctx, `SELECT used_bytes,window_objects FROM tickergarden.content_quota`).Scan(&used, &count); e != nil || count != 2 || used != len(b.Metadata.Data)+len(b.Image.Data) {
		t.Fatal("duplicate charged", used, count, e)
	}
	// Retrieve through a fresh pool and the public handler, with no write session state.
	other, e := pgxpool.NewWithConfig(ctx, pool.Config().Copy())
	if e != nil {
		t.Fatal(e)
	}
	defer other.Close()
	h, e := content.NewHandler(content.Store{Pool: other}, "http://localhost:8791", "http://localhost:5173")
	if e != nil {
		t.Fatal(e)
	}
	req := httptest.NewRequest("GET", "/launch-metadata/"+b.Image.Key, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || !bytes.Equal(rec.Body.Bytes(), img.Bytes()) || rec.Header().Get("Content-Type") != "image/png" || !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("persistent media retrieval", rec.Code)
	}
	req = httptest.NewRequest("POST", "/launch-metadata", bytes.NewReader(raw))
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 201 || !strings.Contains(rec.Body.String(), b.Metadata.Key) {
		t.Fatal("HTTP metadata replay", rec.Code, rec.Body.String())
	}
	// One more unique JSON object exceeds the database's shared hourly limit.
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.content_quota SET max_hourly_objects=window_objects`); e != nil {
		t.Fatal(e)
	}
	next, _ := content.Build([]byte(`{"name":"Second","symbol":"SECOND"}`), "http://localhost:8791")
	if e = store.Save(ctx, next); !errors.Is(e, content.ErrQuota) {
		t.Fatal("hourly quota not enforced", e)
	}
	if _, e = store.Get(ctx, next.Metadata.Key); !errors.Is(e, content.ErrMissing) {
		t.Fatal("rejected content exists", e)
	}
	if e = store.Save(ctx, b); e != nil {
		t.Fatal("quota blocked duplicate retry", e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.content_objects SET payload=payload WHERE key=$1`, b.Metadata.Key); e == nil {
		t.Fatal("immutable object updated")
	}
	if _, e = pool.Exec(ctx, `DELETE FROM tickergarden.content_objects WHERE key=$1`, b.Metadata.Key); e == nil {
		t.Fatal("immutable object deleted")
	}
	if _, e = pool.Exec(ctx, `INSERT INTO tickergarden.content_objects(key,payload,width,height) VALUES($1,$2,0,0)`, strings.Repeat("0", 64)+".json", []byte("{}")); e == nil {
		t.Fatal("incorrect hash stored")
	}
}
