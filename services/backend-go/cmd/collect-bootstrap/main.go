// collect-bootstrap creates a bounded header-only origin corpus. It fails
// closed on bloom positives and never fetches unrelated transaction receipts.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sync"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	manifest := flag.String("manifest", "", "verified runtime manifest")
	output := flag.String("output", "", "new evidence file")
	from := flag.Uint64("from", 0, "deployment start")
	to := flag.Uint64("to", 0, "exclusive business start")
	flag.Parse()
	if *from == 0 || *to <= *from || *to-*from > 4096 || *output == "" {
		return fmt.Errorf("invalid bounded origin interval")
	}
	raw, err := os.ReadFile(*manifest)
	if err != nil {
		return err
	}
	m, err := deployment.Parse(raw)
	if err != nil {
		return err
	}
	rpc, err := chainrpc.New("http://127.0.0.1:18570")
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	id, err := rpc.ChainID(ctx)
	if err != nil || id != m.ChainID {
		return fmt.Errorf("chain mismatch")
	}
	emitters := []string{}
	for _, c := range m.Contracts {
		if c.Module != "UniswapV4PoolManager" {
			emitters = append(emitters, c.Address)
		}
	}
	bundles := []chainrpc.ReceiptRootBundle{}
	previous := ""

	for base := *from; base < *to; base += 4 {
		count := min(uint64(4), *to-base)
		batch := make([]chainrpc.ReceiptRootBundle, count)
		failures := make([]error, count)
		var group sync.WaitGroup
		for offset := uint64(0); offset < count; offset++ {
			group.Add(1)
			go func(j uint64) {
				defer group.Done()
				batch[j], failures[j] = rpc.EventExclusionBundle(ctx, base+j, emitters)
			}(offset)
		}
		group.Wait()
		for offset, bundle := range batch {
			n := base + uint64(offset)
			if failures[offset] != nil {
				return fmt.Errorf("block %d requires review: %w", n, failures[offset])
			}
			var h chainrpc.Header
			if json.Unmarshal(bundle.Header, &h) != nil || (previous != "" && h.ParentHash != previous) {
				return fmt.Errorf("origin ancestry mismatch at %d", n)
			}
			previous = h.Hash
			bundles = append(bundles, bundle)
			if len(bundles)%100 == 0 {
				fmt.Fprintf(os.Stderr, "verified %d/%d header exclusions\n", len(bundles), *to-*from)
			}
		}
	}

	raw, err = json.Marshal(bundles)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(*output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err = f.Write(raw); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "corpus_collected_requires_anchor_verification", "blocks": len(bundles), "evidenceHash": deployment.Hash(raw), "receiptsFetched": 0})
}
