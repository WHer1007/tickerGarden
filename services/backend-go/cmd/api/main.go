package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"tickergarden/backend/internal/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := app.RunAPI(ctx); err != nil {
		slog.Error("api_failed", "error", err.Error())
		os.Exit(1)
	}
}
