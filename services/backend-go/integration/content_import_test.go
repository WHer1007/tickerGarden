package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/content"
)

func testContentImport(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	dir := t.TempDir()
	b, e := content.Build([]byte(`{"name":"Legacy Import","symbol":"OLD"}`), "https://legacy.example")
	if e != nil {
		t.Fatal(e)
	}
	var pretty bytes.Buffer
	if e = json.Indent(&pretty, b.Metadata.Data, "", "  "); e != nil {
		t.Fatal(e)
	}
	data := append(pretty.Bytes(), '\n')
	key := content.Digest(data) + ".json"
	if e = os.WriteFile(filepath.Join(dir, key), data, 0600); e != nil {
		t.Fatal(e)
	}
	plan, e := content.ScanImport(ctx, dir, "https://legacy.example")
	if e != nil {
		t.Fatal(e)
	}
	store := content.Store{Pool: pool}
	if e = store.ApplyImport(ctx, plan, "wrong"); e == nil {
		t.Fatal("wrong digest imported")
	}
	// Prior test exhausted hourly quota: no content or audit may be committed.
	if e = store.ApplyImport(ctx, plan, plan.Digest()); !errors.Is(e, content.ErrQuota) {
		t.Fatal("import bypassed quota", e)
	}
	if _, e = store.Get(ctx, key); !errors.Is(e, content.ErrMissing) {
		t.Fatal("failed import persisted", e)
	}
	var count int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.content_imports`).Scan(&count); e != nil || count != 0 {
		t.Fatal("failed import audited as success", count, e)
	}
	if _, e = pool.Exec(ctx, `UPDATE tickergarden.content_quota SET max_hourly_objects=2000`); e != nil {
		t.Fatal(e)
	}
	if e = store.ApplyImport(ctx, plan, plan.Digest()); e != nil {
		t.Fatal(e)
	}
	if e = store.ApplyImport(ctx, plan, plan.Digest()); e != nil {
		t.Fatal("retry failed", e)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(upload bool) {
			defer wg.Done()
			if upload {
				errs <- store.Save(ctx, b)
			} else {
				errs <- store.ApplyImport(ctx, plan, plan.Digest())
			}
		}(i%2 == 0)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal("concurrent import/upload", err)
		}
	}
	got, e := store.Get(ctx, key)
	if e != nil || !bytes.Equal(got.Data, data) {
		t.Fatal("legacy bytes rewritten", e)
	}
	var actor, session string
	if e = pool.QueryRow(ctx, `SELECT actor,session_user FROM tickergarden.content_imports WHERE digest=$1`, plan.Digest()).Scan(&actor, &session); e != nil || actor != session {
		t.Fatal("actor not recorded", e)
	}
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.content_imports`).Scan(&count); e != nil || count != 1 {
		t.Fatal("duplicate import audit", e)
	}
	if _, e = pool.Exec(ctx, `DELETE FROM tickergarden.content_imports WHERE digest=$1`, plan.Digest()); e == nil {
		t.Fatal("import audit mutable")
	}
	// Changed files invalidate the previously inspected digest before connecting.
	b2, _ := content.Build([]byte(`{"name":"Extra","symbol":"EXTRA"}`), "https://legacy.example")
	if e = os.WriteFile(filepath.Join(dir, b2.Metadata.Key), b2.Metadata.Data, 0600); e != nil {
		t.Fatal(e)
	}
	var out, stderr bytes.Buffer
	if code := content.RunImport(ctx, []string{"--directory", dir, "--origin", "https://legacy.example", "--apply-digest", plan.Digest()}, &out, &stderr); code != 1 || out.Len() != 0 {
		t.Fatal("changed inventory applied", code)
	}
}
