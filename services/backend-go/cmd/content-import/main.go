package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"tickergarden/backend/internal/content"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(content.RunImport(ctx, os.Args[1:], os.Stdout, os.Stderr))
}
