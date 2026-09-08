package migration

import (
	"database/sql"
	"io/fs"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"

	"tickergarden/backend/migrations"
)

func New(db *sql.DB) (*goose.Provider, error) {
	return FromFS(db, migrations.Files)
}

func FromFS(db *sql.DB, files fs.FS) (*goose.Provider, error) {
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return nil, err
	}
	return goose.NewProvider(goose.DialectPostgres, db, files,
		// Explicit schema: PostgreSQL's default "$user",public search_path
		// changes after creating a schema named like the login role.
		goose.WithTableName("public.tickergarden_goose_version"),
		goose.WithDisableGlobalRegistry(true),
		goose.WithSessionLocker(locker),
	)
}
