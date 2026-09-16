package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"tickergarden/backend/internal/operations"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(operations.Run(ctx, os.Args[1:], os.Getenv, os.Stdout, os.Stderr))
}
