package content

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrQuota = errors.New("content quota exhausted")
var ErrMissing = errors.New("content object not found")

type Store struct{ Pool *pgxpool.Pool }

func (s Store) Save(ctx context.Context, b Bundle) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	// Serialize before taking object row locks: imports and uploads can otherwise
	// acquire the shared quota row and deduplicated image rows in opposite order.
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('tickergarden:content-write',0))`); e != nil {
		return e
	}
	objects := []Object{b.Metadata}
	if b.Image != nil {
		objects = append(objects, *b.Image)
	}
	for _, o := range objects {
		if e = saveObject(ctx, tx, o); e != nil {
			return e
		}
	}

	return tx.Commit(ctx)
}
func (s Store) Get(ctx context.Context, key string) (Object, error) {
	if !keyRE.MatchString(key) {
		return Object{}, ErrMissing
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	o := Object{Key: key}
	e := s.Pool.QueryRow(ctx, `SELECT payload,width,height FROM tickergarden.content_objects WHERE key=$1`, key).Scan(&o.Data, &o.Width, &o.Height)
	if errors.Is(e, pgx.ErrNoRows) {
		return Object{}, ErrMissing
	}
	if e != nil {
		return Object{}, e
	}
	if !strings.HasPrefix(key, Digest(o.Data)+".") {
		return Object{}, errors.New("content integrity failure")
	}
	return o, nil
}

func saveObject(ctx context.Context, tx pgx.Tx, o Object) error {
	if !keyRE.MatchString(o.Key) || !strings.HasPrefix(o.Key, Digest(o.Data)+".") {
		return errors.New("invalid content object")
	}
	_, e := tx.Exec(ctx, `INSERT INTO tickergarden.content_objects(key,payload,width,height) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO NOTHING`, o.Key, o.Data, o.Width, o.Height)
	if e != nil {
		var p *pgconn.PgError
		if errors.As(e, &p) && p.Code == "P0001" {
			return ErrQuota
		}
		return e
	}
	var data []byte
	var width, height int
	if e = tx.QueryRow(ctx, `SELECT payload,width,height FROM tickergarden.content_objects WHERE key=$1`, o.Key).Scan(&data, &width, &height); e != nil {
		return e
	}
	if !bytes.Equal(data, o.Data) || width != o.Width || height != o.Height {
		return errors.New("content collision or corruption")
	}
	return nil
}
