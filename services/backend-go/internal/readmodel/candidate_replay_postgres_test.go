package readmodel

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projection"
)

// Use real ABI logs, receipt commitments and replay; no injected provenance rows.
func testMarketCandidateReplay(t *testing.T, ctx context.Context, store ObservationStore, b deployment.ObservationBatch, persist func(deployment.ObservationBatch), exec func(string, ...any)) {
	t.Helper()
	rows := map[string]map[string]any{}
	var marketID string
	for _, o := range b.Observations {
		rows[o.Kind] = o.Value
		if o.Kind == "market" {
			marketID = o.Key
		}
	}
	rows["quote"]["status"] = "1" // This history contains registration, without a later status change.
	market := rows["market"]
	asset := rows["asset"]["asset"].(map[string]any)
	zero := "0x" + strings.Repeat("0", 64)
	for _, field := range []string{"feePolicyId", "executionSpecId", "expectedEconomics"} {
		market[field] = rows["template"]["executionSpecId"]
	}
	market["launchConfigId"] = "1"
	market["creatorRevenueBeneficiaryAtCreation"] = market["memeToken"]
	market["stakingEnabled"] = true
	market["poolId"] = zero
	fixture, err := os.ReadFile("../projection/testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Input projection.Input `json:"input"`
	}
	if json.Unmarshal(fixture, &cases) != nil {
		t.Fatal("golden decode")
	}
	word := func(v any) string {
		s := v.(string)
		if strings.HasPrefix(s, "0x") {
			return strings.Repeat("0", 66-len(s)) + s[2:]
		}
		n, ok := new(big.Int).SetString(s, 10)
		if !ok {
			t.Fatal(s)
		}
		return fmt.Sprintf("%064x", n)
	}
	topic := func(v any) string { return "0x" + word(v) }
	inputs := []projection.Input{}
	add := func(index int, topics []string, data string) {
		in := cases[index].Input
		in.Observations = nil
		in.Log.Topics = append([]string{in.Log.Topics[0]}, topics...)
		in.Log.Data = "0x" + data
		in.Log.BlockNumber = b.BlockNumber
		in.Log.BlockHash = b.BlockHash
		in.Log.LogIndex = fmt.Sprintf("0x%x", len(inputs))
		in.Log.TransactionIndex = "0x0"
		inputs = append(inputs, in)
	}
	add(0, []string{topic(market["assetUid"]), topic(asset["stockToken"]), topic(asset["userStockVault"])}, word(asset["tokenDecimals"]))
	add(1, []string{topic(market["quoteAssetConfigId"]), topic(market["quoteAsset"]), topic(market["tickerGardenBaselineId"])}, word(rows["quote"]["economicsHash"]))
	add(94, []string{topic(market["tickerGardenBaselineId"]), topic(rows["baseline"]["behaviorVectorRoot"])}, word(rows["baseline"]["referenceFactoryCodeHash"]))
	add(95, []string{topic(market["launchTemplateId"]), topic(rows["template"]["templateHash"]), topic(rows["template"]["executionSpecId"])}, "")
	add(96, []string{marketID, topic(market["assetUid"]), topic(market["memeToken"])}, word(market["curve"])+word(market["gauge"])+word(market["quoteAsset"])+word(market["tickerGardenBaselineId"])+word(market["quoteAssetConfigId"])+word(market["launchTemplateId"]))
	inputs[4].Observations = []projection.Observation{{Kind: "market", Key: marketID, Value: projection.Row(market)}}
	add(71, []string{topic(market["assetUid"]), topic(rows["vaultPosition"]["user"])}, word(rows["vaultPosition"]["deposited"]))
	inputs[5].Log.Address = asset["userStockVault"].(string)
	add(48, []string{topic(rows["gaugePosition"]["user"]), marketID}, word("400")+word("120")+word("86400"))
	inputs[6].Log.Address = market["gauge"].(string)
	// Give registry/factory modules distinct synthetic deployment addresses.
	for i := 0; i < 5; i++ {
		inputs[i].Log.Address = fmt.Sprintf("0x%040x", 1000+i)
	}
	logs := []chainrpc.Log{}
	for i, in := range inputs {
		data, _ := json.Marshal(in)
		logData, _ := json.Marshal(in.Log)
		logs = append(logs, in.Log)
		exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,$3,$4,$5)`, b.ChainID, b.BlockHash, i, in.Log.Address, logData)
		exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,$3,$4,$5)`, b.ChainID, b.BlockHash, i, data, deployment.Hash(data))
	}
	receipt := chainrpc.Receipt{BlockHash: b.BlockHash, BlockNumber: b.BlockNumber, TransactionHash: logs[0].TransactionHash, TransactionIndex: "0x0", Status: "0x1", Logs: logs}
	data, _ := json.Marshal(receipt)
	commit, e := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
	if e != nil {
		t.Fatal(e)
	}
	exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,0,'0x1',$4)`, b.ChainID, b.BlockHash, receipt.TransactionHash, data)
	exec(`UPDATE tickergarden.chain_blocks SET receipt_count=1,receipt_set_hash=$1`, commit)
	exec(`UPDATE tickergarden.projection_checkpoints SET input_count=$1`, len(inputs))
	exec(`INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES($1,$2)`, b.ChainID, b.BlockHash)
	discovery := deployment.MarketDiscovery{MarketID: marketID, Source: inputs[4].Log, State: market}
	data, _ = json.Marshal(discovery)
	exec(`INSERT INTO tickergarden.discovered_markets(chain_id,block_hash,market_id,log_index,payload) VALUES($1,$2,$3,4,$4)`, b.ChainID, b.BlockHash, marketID, data)
	persist(b)
	state := projection.New()
	for _, in := range inputs {
		if _, err := state.Apply(in); err != nil {
			t.Fatal("replay input", in.Module, err)
		}
	}
	encoded, _ := state.Snapshot()
	var replay struct {
		Tables map[string]map[string]json.RawMessage `json:"tables"`
	}
	if json.Unmarshal(encoded, &replay) != nil {
		t.Fatal("snapshot")
	}
	if err := verifyCandidateConfigEvidence(b, replay.Tables["configs"]); err != nil {
		t.Fatal("config evidence", err)
	}
	if err := verifyCandidateMarketEvidence(b, map[string]deployment.MarketDiscovery{marketID: discovery}, replay.Tables["markets"]); err != nil {
		t.Fatal("market evidence", err)
	}
	got, e := store.LoadCandidateSet(ctx)
	if e != nil || len(got.Markets) != 1 || len(got.Configs) != 4 || len(got.Positions) != 1 || len(got.CreatorEpochs) != 2 || got.PublicationEligible {
		t.Fatal("market replay", got, e)
	}
	if len(got.Accounts) != 1 || got.Markets[0].Source.LogIndex != 4 || got.Positions[0].Source.LogIndex != 6 || got.Accounts[0].Source.LogIndex != 5 || got.Positions[0].Claimable[1].Amount != "20" {
		t.Fatal("candidate provenance or reward amount mismatch", got)
	}
	if got.FeeReconciliation == nil || got.FeeReconciliation.Status != "unavailable" || got.FeeReconciliation.Reason != "history_evidence_missing" || got.FeeReconciliation.Report != nil || got.FeeReconciliation.BlockHash != got.BlockHash {
		t.Fatal("unbound fee history produced reconciliation", got.FeeReconciliation)
	}
	testAccountEnrichmentPublication(t, ctx, store, got, inputs[:5], exec)
	testFeeClaimReplay(t, ctx, store, receipt, len(inputs), got, exec)
	testFeeReconciliationReplay(t, ctx, store, receipt, inputs, b, persist, exec)
	exec(`UPDATE tickergarden.chain_blocks SET receipts_verified=false`)
	if _, err := store.LoadCandidateSet(ctx); err == nil {
		t.Fatal("incomplete receipts accepted")
	}
	exec(`UPDATE tickergarden.chain_blocks SET receipts_verified=true`)
	if _, err := store.LoadCandidateSet(ctx); err != nil {
		t.Fatal("receipt recovery", err)
	}
	for i, row := range b.Observations {
		if row.Kind != "feeSolvency" {
			continue
		}
		missing := b
		missing.Observations = append(append([]deployment.StateObservation{}, b.Observations[:i]...), b.Observations[i+1:]...)
		missing.Expected = len(missing.Observations)
		persist(missing)
		if _, err := store.LoadCandidateSet(ctx); err == nil {
			t.Fatal("missing fee inventory accepted")
		}
		persist(b)
		if _, err := store.LoadCandidateSet(ctx); err != nil {
			t.Fatal("inventory recovery", err)
		}
		break
	}
	for _, kind := range []string{"feeLiability", "feeSolvency"} {
		for i := range b.Observations {
			o := &b.Observations[i]
			if o.Kind != kind {
				continue
			}
			field := "staker"
			if kind == "feeSolvency" {
				field = "balance"
			}
			old := o.Value[field]
			o.Value[field] = "0"
			persist(b)
			if _, e := store.LoadCandidateSet(ctx); e == nil {
				t.Fatal("full candidate accepted invalid", kind)
			}
			o.Value[field] = old
			persist(b)
			if _, e := store.LoadCandidateSet(ctx); e != nil {
				t.Fatal("candidate recovery", e)
			}
			break
		}
	}
}
