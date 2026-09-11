// Imports only explicitly recorded current-release Stock registration blocks.
// Display discovery data only; no financial snapshot or history certification.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strconv"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/demandevents"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	if os.Getenv("TG_PROFILE") != "test" || os.Getenv("TG_CHAIN_ID") != "46630" || len(os.Args) != 2 {
		return fmt.Errorf("current test profile and activation file required")
	}
	var a struct {
		Status, ReleaseID string
		ChainID           uint64
		Transactions      []struct{ ID, To, Status, TransactionHash, BlockNumber, BlockHash string }
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		return err
	}
	if json.Unmarshal(raw, &a) != nil || a.Status != "ACTIVE_TEST_ONLY" || a.ChainID != 46630 || a.ReleaseID != os.Getenv("V1_RELEASE_ID") {
		return fmt.Errorf("activation identity mismatch")
	}
	raw, err = os.ReadFile(os.Getenv("TG_DEPLOYMENT_MANIFEST"))
	if err != nil {
		return err
	}
	m, err := deployment.Parse(raw)
	if err != nil || m.ChainID != 46630 {
		return fmt.Errorf("invalid current manifest")
	}
	registry := ""
	for _, c := range m.Contracts {
		if c.Module == "OfficialStockRegistryV1" {
			registry = c.Address
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	rpc, err := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if err != nil {
		return err
	}
	id, err := rpc.ChainID(ctx)
	if err != nil || id != 46630 {
		return fmt.Errorf("wrong RPC chain")
	}
	type entry struct {
		scope             demandevents.Scope
		log               chainrpc.Log
		decoded           events.Decoded
		height, ti, index uint64
	}
	entries := []entry{}
	seen := map[string]bool{}
	for _, t := range a.Transactions {
		if !strings.HasPrefix(t.ID, "register-") {
			continue
		}
		if t.Status != "CONFIRMED" || strings.ToLower(t.To) != registry {
			return fmt.Errorf("unconfirmed registration")
		}
		n, err := strconv.ParseUint(t.BlockNumber, 10, 64)
		if err != nil {
			return err
		}
		h, err := rpc.Header(ctx, fmt.Sprintf("0x%x", n))
		if err != nil || h.Hash != t.BlockHash {
			return fmt.Errorf("registration canonical block mismatch")
		}
		logs, err := rpc.ProjectLogs(ctx, []string{registry}, []string{deployment.Hash([]byte("AssetRegistered(bytes32,address,address,uint8)"))}, n, n)
		if err != nil {
			return err
		}
		found := false
		for _, l := range logs {
			if l.TransactionHash != t.TransactionHash {
				continue
			}
			decoded, err := events.Decode("OfficialStockRegistryV1", l)
			if err != nil {
				return err
			}
			uid, ok := decoded.Args["assetUid"].(string)
			if !ok || seen[uid] {
				return fmt.Errorf("duplicate registration")
			}
			seen[uid] = true
			ti, err := chainrpc.Quantity(l.TransactionIndex)
			if err != nil {
				return err
			}
			li, err := chainrpc.Quantity(l.LogIndex)
			if err != nil {
				return err
			}
			scope := demandevents.Scope{ID: "registration:" + a.ReleaseID + ":" + t.TransactionHash, ChainID: 46630, Start: n, Modules: map[string]string{registry: "OfficialStockRegistryV1"}}
			entries = append(entries, entry{scope, l, decoded, n, ti, li})
			found = true
		}
		if !found {
			return fmt.Errorf("missing registration receipt event")
		}
	}
	if len(entries) != 5 {
		return fmt.Errorf("expected five current registrations")
	}
	pool, err := pgxpool.New(ctx, os.Getenv("TG_DATABASE_URL"))
	if err != nil {
		return err
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, v := range entries {
		config, _ := json.Marshal(v.scope)
		payload, _ := json.Marshal(struct {
			chainrpc.Log
			Event events.Decoded `json:"event"`
		}{v.log, v.decoded})
		_, err = tx.Exec(ctx, `INSERT INTO tickergarden.demand_event_scopes(scope_id,chain_id,config,start_block,read_through,processed_through) VALUES($1,46630,$2,$3,$3,$3) ON CONFLICT DO NOTHING`, v.scope.ID, config, v.height)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO tickergarden.demand_event_records(scope_id,block_number,transaction_index,log_index,block_hash,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, v.scope.ID, v.height, v.ti, v.index, v.log.BlockHash, payload)
		if err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	fmt.Println("CURRENT_STOCK_REGISTRATIONS_IMPORTED", len(entries))
	return nil
}
