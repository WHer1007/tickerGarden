package content

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"tickergarden/backend/internal/postgres"
)

func RunImport(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("content-import", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dir := flags.String("directory", "", "flat legacy content export directory")
	origin := flags.String("origin", "", "original public origin; existing URLs are preserved")
	expected := flags.String("apply-digest", "", "apply only this previously inspected inventory digest; default is dry run")
	if e := flags.Parse(args); e != nil {
		if e == flag.ErrHelp {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 || *dir == "" || !Origin(*origin) {
		fmt.Fprintln(stderr, "--directory and valid --origin required")
		return 2
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	plan, e := ScanImport(ctx, *dir, *origin)
	if e != nil {
		fmt.Fprintln(stderr, e)
		return 1
	}
	status := "validated_dry_run"
	if *expected != "" {
		if plan.Digest() != *expected {
			fmt.Fprintln(stderr, "import inventory digest mismatch; inspect a new dry run")
			return 1
		}
		dsn := os.Getenv("TG_CONTENT_IMPORT_DATABASE_URL")
		if dsn == "" {
			fmt.Fprintln(stderr, "TG_CONTENT_IMPORT_DATABASE_URL is required to apply")
			return 1
		}
		pool, e := postgres.Open(ctx, dsn, 2)
		if e != nil {
			fmt.Fprintln(stderr, "cannot configure import store")
			return 1
		}
		defer pool.Close()
		if e = (Store{Pool: pool}).ApplyImport(ctx, plan, *expected); e != nil {
			fmt.Fprintln(stderr, "content import failed; no confirmed completion, retry same inventory after checking store/quota")
			return 1
		}
		status = "committed"
	}
	result := struct {
		Status string       `json:"status"`
		Digest string       `json:"digest"`
		Report ImportReport `json:"report"`
	}{status, plan.Digest(), plan.Report()}
	if json.NewEncoder(stdout).Encode(result) != nil {
		return 1
	}
	return 0
}
