package main

import (
	"os"
	"tickergarden/backend/internal/treasury"
)

func main() { os.Exit(treasury.Run(os.Args[1:], os.Stdout, os.Stderr)) }
