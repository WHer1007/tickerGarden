package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"tickergarden/backend/internal/app"
)

func main() {
	if len(os.Args) == 2 && (os.Args[1] == "--help" || os.Args[1] == "-h") {
		fmt.Println("content-worker --run: immutable launch metadata HTTP service; requires TG_CONTENT_DATABASE_URL, TG_CONTENT_PUBLIC_ORIGIN, TG_CONTENT_WEB_ORIGIN")
		return
	}
	if len(os.Args) != 2 || os.Args[1] != "--run" {
		fmt.Fprintln(os.Stderr, "use content-worker --run or --help")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if e := app.RunContent(ctx); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
