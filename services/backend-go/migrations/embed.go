package migrations

import "embed"

// Files are embedded so the migration binary can run independently of its cwd.
//
//go:embed *.sql
var Files embed.FS
