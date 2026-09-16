package projector

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

func TestPrincipalObservationsResumesNonAdjacentCheckpoint(t *testing.T) {
	c := eventTestDB(t)
	ctx := context.Background()
	exec := func(q string, a ...any) {
		t.Helper()
		if _, err := c.Exec(ctx, q, a...); err != nil {
			t.Fatal(err)
		}
	}
	chain, start := uint64(421614), uint64(10)
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES($1,$2,10,12,$3,12,$3)`, chain, eventHeader(1).Hash, eventHeader(12).Hash)
	for n := start; n <= 12; n++ {
		h := eventHeader(n)
		exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES($1,$2,$3,$4,$5,true)`, chain, n, h.Hash, h.ParentHash, 100+n)
	}
	manifest := "0x" + fmt.Sprintf("%064x", 55)
	tx, err := c.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = principalObservations(ctx, tx, chain, start, start, eventHeader(start).Hash, nil, manifest, 0, nil); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	prior := eventHeader(start).Hash
	tx, err = c.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = principalObservations(ctx, tx, chain, 12, start, eventHeader(12).Hash, &prior, manifest, 0, nil); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var parent *string
	if err = c.QueryRow(ctx, `SELECT parent_hash FROM tickergarden.principal_checkpoints WHERE chain_id=$1 AND block_hash=$2`, chain, eventHeader(12).Hash).Scan(&parent); err != nil {
		t.Fatal(err)
	}
	if parent == nil || *parent != prior {
		t.Fatalf("checkpoint parent = %v, want %s", parent, prior)
	}
	for name, badManifest := range map[string]string{"manifest": "0x" + fmt.Sprintf("%064x", 56), "prior inputs": manifest} {
		t.Run(name, func(t *testing.T) {
			tx, e := c.Begin(ctx)
			if e != nil {
				t.Fatal(e)
			}
			defer tx.Rollback(ctx)
			inputs := uint64(0)
			if name == "prior inputs" {
				inputs = 1
			}
			m := manifest
			if name == "manifest" {
				m = badManifest
			}
			if _, e = principalObservations(ctx, tx, chain, 12, start, eventHeader(12).Hash, &prior, m, inputs, nil); e == nil {
				t.Fatal("accepted invalid checkpoint scope")
			}
		})
	}
}

func TestEmptyFinancialEndPostgresBoundaries(t *testing.T) {
	c := eventTestDB(t)
	ctx := context.Background()
	exec := func(q string, a ...any) {
		t.Helper()
		if _, err := c.Exec(ctx, q, a...); err != nil {
			t.Fatal(err)
		}
	}
	chain := uint64(421614)
	gen := eventHeader(1).Hash
	exec(`INSERT INTO tickergarden.chain_journal(chain_id,genesis_hash,start_block,tip_number,tip_hash,finalized_number,finalized_hash) VALUES($1,$2,10,12,$3,12,$3)`, chain, gen, eventHeader(12).Hash)
	for n := uint64(10); n <= 12; n++ {
		h := eventHeader(n)
		exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified) VALUES($1,$2,$3,$4,$5,true)`, chain, n, h.Hash, h.ParentHash, 100+n)
	}
	exec(`INSERT INTO tickergarden.discovery_checkpoints(chain_id,manifest_hash,start_block,tip_number,tip_hash) VALUES($1,$2,10,12,$3)`, chain, eventHeader(2).Hash, eventHeader(12).Hash)
	for n := uint64(10); n <= 12; n++ {
		exec(`INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES($1,$2)`, chain, eventHeader(n).Hash)
	}
	first := eventHeader(10)
	emitter := "0x0000000000000000000000000000000000000011"
	w := Worker{Manifest: deployment.Manifest{Contracts: []deployment.Contract{{Module: "TickerGardenFactoryV1", Address: emitter, RuntimeCodeHash: fmt.Sprintf("0x%064x", 1)}}}}
	call := func(ceiling uint64) (chainrpc.Header, error) {
		tx, e := c.Begin(ctx)
		if e != nil {
			return first, e
		}
		defer tx.Rollback(ctx)
		return w.emptyFinancialEnd(ctx, tx, chain, first, ceiling)
	}
	got, e := call(12)
	if e != nil || got.Hash != eventHeader(12).Hash {
		t.Fatalf("empty range: %v %+v", e, got)
	}
	exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,0,$3,'{}')`, chain, eventHeader(11).Hash, emitter)
	got, e = call(12)
	if e != nil || got.Hash != eventHeader(10).Hash {
		t.Fatalf("middle candidate log: %v %+v", e, got)
	}
	exec(`DELETE FROM tickergarden.chain_logs`)
	exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,0,$3,'{}')`, chain, eventHeader(10).Hash, emitter)
	got, e = call(12)
	if e != nil || got.Hash != eventHeader(10).Hash {
		t.Fatalf("first candidate log: %v %+v", e, got)
	}
	exec(`DELETE FROM tickergarden.chain_logs`)
	exec(`UPDATE tickergarden.chain_blocks SET canonical=false WHERE number=11`)
	if _, e = call(12); e == nil {
		t.Fatal("accepted missing canonical block")
	}
	exec(`UPDATE tickergarden.chain_blocks SET canonical=true`)
	exec(`UPDATE tickergarden.chain_blocks SET parent_hash=$1 WHERE number=11`, eventHeader(99).Hash)
	if _, e = call(12); e == nil {
		t.Fatal("accepted parent discontinuity")
	}
	exec(`UPDATE tickergarden.chain_blocks SET parent_hash=$1 WHERE number=11`, eventHeader(10).Hash)
	// A future discovered instance becomes a candidate before its first use.
	exec(`DELETE FROM tickergarden.chain_logs`)
	future := "0x0000000000000000000000000000000000000033"
	exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,0,$3,'{}')`, chain, eventHeader(12).Hash, future)
	payload, _ := json.Marshal(map[string]any{"marketId": fmt.Sprintf("0x%064x", 7), "contracts": []deployment.Contract{{Module: "TickerGardenCurve", Address: future, RuntimeCodeHash: fmt.Sprintf("0x%064x", 8)}}})
	exec(`INSERT INTO tickergarden.discovered_markets(chain_id,block_hash,market_id,log_index,payload) VALUES($1,$2,$3,0,$4)`, chain, eventHeader(12).Hash, fmt.Sprintf("0x%064x", 7), payload)
	got, e = call(12)
	if e != nil || got.Hash != eventHeader(11).Hash {
		t.Fatalf("future discovered candidate query: %v %+v", e, got)
	}
}
