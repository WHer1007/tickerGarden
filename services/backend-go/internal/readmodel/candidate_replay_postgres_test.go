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
	// Exercise both Holder mechanisms through the full store entry point. The
	// controlled creation observation and persisted discovery must agree.

	// Block 1 holds creation/config facts; block 2 requests/publishes using block
	// 1 as source; block 3 confirms/claims. Receipts remain synthetic ABI fixtures.
	sourceHash := b.BlockHash
	publicationHash := deployment.Hash([]byte("request block"))
	b.BlockNumber = "0x3"
	b.BlockHash = deployment.Hash([]byte("confirmation block"))
	emptyCommit, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{})
	if err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE tickergarden.chain_blocks SET block_timestamp=60 WHERE hash=$1`, sourceHash)
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified,receipt_count,receipt_set_hash) VALUES($1,2,$2,$3,70,true,0,$4)`, b.ChainID, publicationHash, sourceHash, emptyCommit)
	exec(`INSERT INTO tickergarden.chain_blocks(chain_id,number,hash,parent_hash,block_timestamp,receipts_verified,receipt_count,receipt_set_hash) VALUES($1,3,$2,$3,100,true,1,$4)`, b.ChainID, b.BlockHash, publicationHash, emptyCommit)
	exec(`UPDATE tickergarden.chain_journal SET tip_number=3,tip_hash=$1,finalized_number=3,finalized_hash=$1`, b.BlockHash)
	exec(`UPDATE tickergarden.discovery_checkpoints SET tip_number=3,tip_hash=$1`, b.BlockHash)
	exec(`UPDATE tickergarden.projection_checkpoints SET tip_number=3,tip_hash=$1`, b.BlockHash)
	confirmationTx := deployment.Hash([]byte("confirmation transaction"))
	placeholder := chainrpc.Receipt{BlockHash: b.BlockHash, BlockNumber: b.BlockNumber, TransactionHash: confirmationTx, TransactionIndex: "0x0", Status: "0x1", Logs: []chainrpc.Log{}}
	placeholderData, _ := json.Marshal(placeholder)
	exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,0,'0x1',$4)`, b.ChainID, b.BlockHash, confirmationTx, placeholderData)
	for _, mode := range []string{"epoch", "continuous"} {
		t.Run("Holder full replay/"+mode, func(t *testing.T) {
			encoded, err := json.Marshal(b)
			if err != nil {
				t.Fatal(err)
			}
			var batch deployment.ObservationBatch
			if json.Unmarshal(encoded, &batch) != nil {
				t.Fatal("batch clone")
			}
			var observedMarket map[string]any
			for i := range batch.Observations {
				o := &batch.Observations[i]
				if o.Kind == "market" {
					o.Value["creatorFeesToHolders"] = true
					observedMarket = o.Value
				}
			}
			fixtureData, err := os.ReadFile("testdata/holders/" + mode + ".json")
			if err != nil {
				t.Fatal(err)
			}
			var fixture deployment.ObservationBatch
			if json.Unmarshal(fixtureData, &fixture) != nil {
				t.Fatal("holder fixture")
			}
			for _, o := range fixture.Observations {
				switch o.Kind {
				case "holderMarket", "holderEpoch":
					o.Value["marketId"] = marketID
					if mode == "continuous" {
						o.Value["lastFundingAt"] = "100"
					}
					if mode == "epoch" && o.Kind == "holderMarket" {
						o.Value["epochDuration"] = "50"
					}
					if o.Kind == "holderEpoch" {
						o.Value["sourceBlockNumber"] = "1"
						o.Value["sourceBlockHash"] = sourceHash
						o.Value["window"] = map[string]any{"start": "1", "end": "51"}
						o.Value["requestedAt"] = "70"
						o.Value["requester"] = market["memeToken"]
						o.Value["serviceFeeAmount"] = "1"
						o.Value["serviceFeeAsset"] = market["quoteAsset"]
						o.Value["publishBy"] = "80"
						o.Value["finalizeAfter"] = "80"
						o.Value["claimUntil"] = "200"
						if o.Value["epoch"] == "2" {
							o.Value["requester"] = "0x" + strings.Repeat("0", 40)
							o.Value["serviceFeeAsset"] = "0x" + strings.Repeat("0", 40)
							o.Value["window"] = map[string]any{"start": "51", "end": "101"}
							for _, k := range []string{"status", "requestedAt", "publishBy", "finalizeAfter", "claimUntil", "sourceBlockNumber", "leafCount", "serviceFeeAmount", "quoteAmount", "claimedAmount", "totalTwab"} {
								o.Value[k] = "0"
							}
							for _, k := range []string{"sourceBlockHash", "merkleRoot", "datasetHash"} {
								o.Value[k] = "0x" + strings.Repeat("0", 64)
							}
						}
					}
					for _, k := range []string{"memeToken", "token", "memeAsset"} {
						if _, ok := o.Value[k]; ok {
							o.Value[k] = market["memeToken"]
						}
					}
					for _, k := range []string{"quoteToken", "quote", "quoteAsset", "currentServiceFeeAsset"} {
						if _, ok := o.Value[k]; ok {
							o.Value[k] = market["quoteAsset"]
						}
					}
					o.Key = marketID
					if o.Kind == "holderEpoch" {
						o.Key += ":" + o.Value["epoch"].(string)
					}
				case "treasurySolvency":
					o.Value["asset"] = market["quoteAsset"]
					o.Key = o.Value["treasuryDistributor"].(string) + ":" + market["quoteAsset"].(string)
				default:
					continue
				}
				batch.Observations = append(batch.Observations, o)
			}
			batch.Expected = len(batch.Observations)
			creation := inputs[4]
			creation.Observations = []projection.Observation{{Kind: "market", Key: marketID, Value: projection.Row(observedMarket)}}
			inputData, _ := json.Marshal(creation)
			d := discovery
			d.State = observedMarket
			discoveryData, _ := json.Marshal(d)
			exec(`UPDATE tickergarden.projection_inputs SET payload=$1,digest=$2 WHERE log_index=4`, inputData, deployment.Hash(inputData))
			exec(`UPDATE tickergarden.discovered_markets SET payload=$1`, discoveryData)
			exec(`DELETE FROM tickergarden.projection_inputs WHERE block_hash=$1`, b.BlockHash)
			exec(`DELETE FROM tickergarden.chain_logs WHERE block_hash=$1`, b.BlockHash)
			exec(`DELETE FROM tickergarden.projection_inputs WHERE block_hash=$1`, publicationHash)
			exec(`DELETE FROM tickergarden.chain_logs WHERE block_hash=$1`, publicationHash)
			exec(`DELETE FROM tickergarden.chain_receipts WHERE block_hash=$1`, publicationHash)
			exec(`UPDATE tickergarden.chain_blocks SET receipt_count=0,receipt_set_hash=$1 WHERE number=2`, emptyCommit)
			var publicationData, requestData []byte
			var claimInputData, registrationData []byte
			extraIndex := 1
			prefixLogs := []chainrpc.Log{}
			claim := cases[82].Input
			claim.Observations = nil
			claim.Log = logs[0]
			claim.Log.BlockNumber = b.BlockNumber
			claim.Log.BlockHash = b.BlockHash
			claim.Log.TransactionHash = confirmationTx
			claim.Log.LogIndex = fmt.Sprintf("0x%x", extraIndex)
			if mode == "epoch" {
				claim.Log.Topics = []string{cases[82].Input.Log.Topics[0], marketID, topic("1"), topic("0")}
				claim.Log.Data = "0x" + word(market["memeToken"]) + word("32") + word("3")
			} else {
				claim.Module = "HolderRewardsDistributorV1"
				claim.Log.Topics = []string{cases[36].Input.Log.Topics[0], marketID}
				claim.Log.Data = "0x" + word("3") + word("86500")
			}
			for _, o := range batch.Observations {
				if o.Kind == "holderMarket" {
					claim.Log.Address = o.Value["treasuryDistributor"].(string)
				}
			}
			{
				registration := claim
				registration.Log = claim.Log
				registration.Log.LogIndex = "0x0"
				registration.Log.Topics = []string{cases[37].Input.Log.Topics[0], marketID, topic(market["memeToken"])}
				registration.Log.Data = "0x" + word(market["quoteAsset"]) + word(market["memeToken"])
				if mode == "epoch" {
					for _, o := range batch.Observations {
						if o.Kind == "holderEpoch" && o.Value["epoch"] == "1" {
							registration.Log.Topics = []string{cases[63].Input.Log.Topics[0], marketID, topic("1"), o.Value["merkleRoot"].(string)}
							registration.Log.Data = "0x" + word(o.Value["claimUntil"])
						}
					}
				}
				registrationData, _ = json.Marshal(registration)
				rawLog, _ := json.Marshal(registration.Log)
				exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,0,$3,$4)`, b.ChainID, b.BlockHash, registration.Log.Address, rawLog)
				exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,0,$3,$4)`, b.ChainID, b.BlockHash, registrationData, deployment.Hash(registrationData))
				prefixLogs = append(prefixLogs, registration.Log)
			}
			claimInputData, _ = json.Marshal(claim)
			logData, _ := json.Marshal(claim.Log)
			exec(fmt.Sprintf(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,%d,$3,$4)`, extraIndex), b.ChainID, b.BlockHash, claim.Log.Address, logData)
			exec(fmt.Sprintf(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,%d,$3,$4)`, extraIndex), b.ChainID, b.BlockHash, claimInputData, deployment.Hash(claimInputData))
			exec(`UPDATE tickergarden.projection_checkpoints SET input_count=$1`, 7+extraIndex+1)
			withClaim := placeholder
			withClaim.Logs = append(prefixLogs, claim.Log)
			receiptData, _ := json.Marshal(withClaim)
			receiptHash, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{withClaim})
			if err != nil {
				t.Fatal(err)
			}
			exec(`UPDATE tickergarden.chain_receipts SET payload=$1 WHERE block_hash=$2`, receiptData, b.BlockHash)
			exec(`UPDATE tickergarden.chain_blocks SET receipt_set_hash=$1 WHERE hash=$2`, receiptHash, b.BlockHash)
			if mode == "epoch" {
				publication := claim
				publication.Log.BlockNumber = "0x2"
				publication.Log.BlockHash = publicationHash
				publication.Log.TransactionHash = deployment.Hash([]byte("earlier publication transaction"))
				publication.Log.LogIndex = "0x1"
				var request projection.Input
				for _, o := range batch.Observations {
					if o.Kind == "holderEpoch" && o.Value["epoch"] == "1" {
						publication.Log.Topics = []string{deployment.Hash([]byte("RootPublished(bytes32,uint32,bytes32,bytes32,uint256,uint32,uint64)")), marketID, topic("1"), o.Value["merkleRoot"].(string)}
						publication.Log.Data = "0x" + word(o.Value["datasetHash"]) + word(o.Value["totalTwab"]) + word(o.Value["leafCount"]) + word(o.Value["finalizeAfter"])
						values := map[string]string{}
						for k, v := range o.Value {
							if text, ok := v.(string); ok {
								values[k] = text
							}
						}
						window := o.Value["window"].(map[string]any)
						values["windowstart"] = window["start"].(string)
						values["windowend"] = window["end"].(string)
						request = holderRequestInput(publication, values)
						request.Log.LogIndex = "0x0"
					}
				}
				publicationData, _ = json.Marshal(publication)
				publicationLog, _ := json.Marshal(publication.Log)
				exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,1,$3,$4)`, b.ChainID, publicationHash, publication.Log.Address, publicationLog)
				exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,1,$3,$4)`, b.ChainID, publicationHash, publicationData, deployment.Hash(publicationData))
				requestData, _ = json.Marshal(request)
				requestLog, _ := json.Marshal(request.Log)
				exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,0,$3,$4)`, b.ChainID, publicationHash, request.Log.Address, requestLog)
				exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,0,$3,$4)`, b.ChainID, publicationHash, requestData, deployment.Hash(requestData))
				r := chainrpc.Receipt{BlockHash: publicationHash, BlockNumber: "0x2", TransactionHash: publication.Log.TransactionHash, TransactionIndex: "0x0", Status: "0x1", Logs: []chainrpc.Log{request.Log, publication.Log}}
				rd, _ := json.Marshal(r)
				rc, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{r})
				if err != nil {
					t.Fatal(err)
				}
				exec(`INSERT INTO tickergarden.chain_receipts(chain_id,block_hash,transaction_hash,transaction_index,status,payload) VALUES($1,$2,$3,0,'0x1',$4)`, b.ChainID, publicationHash, r.TransactionHash, rd)
				exec(`UPDATE tickergarden.chain_blocks SET receipt_count=1,receipt_set_hash=$1 WHERE number=2`, rc)
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=11`)
			}
			check := func(valid bool) {
				t.Helper()
				got, err := store.LoadCandidateSet(ctx)
				if (err == nil) != valid {
					t.Fatal("Holder candidate gate", mode, err)
				}
				if valid && mode == "epoch" && (!got.TreasuryClaimHistoryVerified || len(got.TreasuryClaims) != 1 || got.TreasuryClaims[0].Amount != "3" || got.TreasuryClaims[0].LeafIndex != "0") {
					t.Fatal("claim export", got.TreasuryClaims)
				}
				if valid && (!got.ServiceCreditHistoryVerified || (mode == "epoch" && (len(got.ServiceCredits) != 1 || got.ServiceCredits[0].Amount != "1"))) {
					t.Fatal("credit history export", got.ServiceCredits)
				}
				if valid && (got.PublicationEligible || len(got.HolderMarkets) != 1 || got.HolderMarkets[0].MarketID != marketID) {
					t.Fatal("Holder candidate inventory", got)
				}
				if valid && ((mode == "continuous" && got.HolderMarkets[0].Continuous == nil) || (mode == "epoch" && (got.HolderMarkets[0].Epoch == nil || len(got.HolderMarkets[0].Epoch.Entries) != 2))) {
					t.Fatal("Holder mechanism mismatch", got.HolderMarkets)
				}
			}
			persist(batch)
			check(true)
			if mode == "epoch" {
				// Synthetic root evidence: test complete configured range, including
				// request/publication block 2 and finalization/claim block 3.
				original, err := store.LoadCandidateSet(ctx)
				if err != nil || original.HistoryReceiptRootsVerified || original.HistoryStartBlock != store.StartBlock {
					t.Fatal("unproven history", err)
				}
				exec(`UPDATE tickergarden.chain_blocks SET receipts_root=$1,root_receipt_set_hash=receipt_set_hash WHERE canonical AND number=3`, deployment.Hash([]byte("synthetic root")))
				partial, err := store.LoadCandidateSet(ctx)
				if err != nil || partial.HistoryReceiptRootsVerified {
					t.Fatal("candidate-only root accepted as history", err)
				}
				exec(`UPDATE tickergarden.chain_blocks SET receipts_root=$1,root_receipt_set_hash=receipt_set_hash WHERE canonical`, deployment.Hash([]byte("synthetic root")))
				complete, err := store.LoadCandidateSet(ctx)
				if err != nil || !complete.HistoryReceiptRootsVerified || complete.PublicationEligible {
					t.Fatal("complete root history", err)
				}

				// This replay fixture has no emitter manifest. Root coverage
				// alone must never enable public account enrichment.
				producer := accountFixture(t)
				producer.Accounts = nil
				producer.Configs, producer.Markets, producer.Positions = complete.Configs, complete.Markets, complete.Positions
				producer.Sync.ChainID = complete.ChainID
				producer.Sync.BlockNumber, producer.Sync.BlockHash = &complete.BlockNumber, &complete.BlockHash
				producer.Sync.HeadBlockNumber, producer.Sync.HeadBlockHash = &complete.BlockNumber, &complete.BlockHash
				producer.Sync.Revision = complete.BlockNumber + ":" + complete.BlockHash
				producerData, err := json.Marshal(producer)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := Parse(producerData, complete.ChainID); err != nil {
					t.Fatal("invalid enrichment input", err)
				}
				if enriched, err := store.EnrichAccounts(ctx, producerData); err == nil || enriched != nil || !strings.Contains(err.Error(), "matching verified candidate coverage") {
					t.Fatal("root-only database candidate enriched without emitter coverage", err)
				}
				exec(`UPDATE tickergarden.chain_blocks SET receipts_root=NULL,root_receipt_set_hash=NULL WHERE number=2`)
				missingRequest, err := store.LoadCandidateSet(ctx)
				if err != nil || missingRequest.HistoryReceiptRootsVerified {
					t.Fatal("missing request block evidence accepted", err)
				}
				exec(`UPDATE tickergarden.chain_blocks SET receipts_root=NULL,root_receipt_set_hash=NULL`)
			}
			if mode == "continuous" {
				// Keep observation time coherent, but move the actual receipt block
				// timestamp away from the stream event's end-minus-duration.
				for i := range batch.Observations {
					if batch.Observations[i].Kind == "creatorEpoch" {
						batch.Observations[i].Value["observedAtTimestamp"] = "101"
					}
				}
				exec(`UPDATE tickergarden.chain_blocks SET block_timestamp=101 WHERE hash=$1`, b.BlockHash)
				persist(batch)
				check(false)
				for i := range batch.Observations {
					if batch.Observations[i].Kind == "creatorEpoch" {
						batch.Observations[i].Value["observedAtTimestamp"] = "100"
					}
				}
				exec(`UPDATE tickergarden.chain_blocks SET block_timestamp=100 WHERE hash=$1`, b.BlockHash)
				persist(batch)
				check(true)
				exec(`DELETE FROM tickergarden.projection_inputs WHERE log_index=1 AND block_hash=$1`, b.BlockHash)
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=8`)
				check(false)
				exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,1,$3,$4)`, b.ChainID, b.BlockHash, claimInputData, deployment.Hash(claimInputData))
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=9`)
				check(true)
				exec(`DELETE FROM tickergarden.projection_inputs WHERE log_index=0 AND block_hash=$1`, b.BlockHash)
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=8`)
				check(false)
				exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,0,$3,$4)`, b.ChainID, b.BlockHash, registrationData, deployment.Hash(registrationData))
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=9`)
				check(true)
			}
			if mode == "epoch" {
				// A reset epoch no longer carries its source; retained request history must.
				tx, err := store.Pool.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				forgotten := []HolderMarketCandidate{{Mode: "epoch", Distributor: claim.Log.Address, Epoch: &EpochHolderCandidate{}}}
				history := []holderRequestSource{{claim.Log.Address, 2, 1, sourceHash}}
				if err := store.verifyHolderSourceBlocks(ctx, tx, forgotten, history); err != nil {
					t.Fatal("reset source", err)
				}
				history[0].hash = deployment.Hash([]byte("wrong reset source"))
				if store.verifyHolderSourceBlocks(ctx, tx, forgotten, history) == nil {
					t.Fatal("wrong reset source accepted")
				}
				history[0].source = 9
				if store.verifyHolderSourceBlocks(ctx, tx, forgotten, history) == nil {
					t.Fatal("missing reset source accepted")
				}
				if err := tx.Rollback(ctx); err != nil {
					t.Fatal(err)
				}
				for i := range batch.Observations {
					o := &batch.Observations[i]
					if o.Kind != "holderMarket" {
						continue
					}
					for field, wrong := range map[string]string{"finalityDelayBlocks": "2", "finalityDelaySeconds": "20", "rootPublicationWindow": "11", "rootReviewDelay": "11", "claimWindow": "101"} {
						old := o.Value[field]
						o.Value[field] = wrong
						persist(batch)
						check(false)
						o.Value[field] = old
						persist(batch)
						check(true)
					}
				}
				// Keep a complete receipt/log, but omit its decoded claim input.
				exec(`DELETE FROM tickergarden.projection_inputs WHERE log_index=1 AND block_hash=$1`, b.BlockHash)
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=10`)
				check(false)
				exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,1,$3,$4)`, b.ChainID, b.BlockHash, claimInputData, deployment.Hash(claimInputData))
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=11`)
				check(true)
				exec(`DELETE FROM tickergarden.projection_inputs WHERE log_index=0 AND block_hash=$1`, b.BlockHash)
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=10`)
				check(false)
				exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,0,$3,$4)`, b.ChainID, b.BlockHash, registrationData, deployment.Hash(registrationData))
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=11`)
				check(true)
				exec(`DELETE FROM tickergarden.projection_inputs WHERE block_hash=$1 AND log_index=1`, publicationHash)
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=10`)
				check(false)
				exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,1,$3,$4)`, b.ChainID, publicationHash, publicationData, deployment.Hash(publicationData))
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=11`)
				check(true)
				exec(`DELETE FROM tickergarden.projection_inputs WHERE block_hash=$1 AND log_index=0`, publicationHash)
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=10`)
				check(false)
				exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,0,$3,$4)`, b.ChainID, publicationHash, requestData, deployment.Hash(requestData))
				exec(`UPDATE tickergarden.projection_checkpoints SET input_count=11`)
				check(true)
				for i := range batch.Observations {
					o := &batch.Observations[i]
					if o.Kind != "holderEpoch" {
						continue
					}
					old := o.Value["holderMemeLiability"]
					o.Value["holderMemeLiability"] = "1"
					persist(batch)
					check(false)
					o.Value["holderMemeLiability"] = old
					persist(batch)
					check(true)
					break
				}
				for i := range batch.Observations {
					o := &batch.Observations[i]
					if o.Kind != "holderEpoch" || o.Value["status"] != "3" {
						continue
					}
					oldDeadline := o.Value["claimUntil"]
					o.Value["claimUntil"] = "100"
					persist(batch)
					check(false)
					o.Value["claimUntil"] = "99"
					persist(batch)
					check(false)
					o.Value["claimUntil"] = oldDeadline
					persist(batch)
					check(true)
					old := o.Value["merkleRoot"]
					o.Value["merkleRoot"] = "0x" + strings.Repeat("0", 64)
					persist(batch)
					check(false)
					o.Value["merkleRoot"] = old
					persist(batch)
					check(true)
					break
				}
				for i := range batch.Observations {
					o := &batch.Observations[i]
					if o.Kind != "holderMarket" {
						continue
					}
					o.Value["epochDuration"] = "51"
					persist(batch)
					check(false)
					o.Value["epochDuration"] = "50"
					persist(batch)
					check(true)
					break
				}
				// Agreeing on the same wrong hash must reach and fail the SQL lookup.
				for i := range batch.Observations {
					if batch.Observations[i].Kind == "holderEpoch" && batch.Observations[i].Value["status"] != "0" {
						batch.Observations[i].Value["sourceBlockHash"] = deployment.Hash([]byte("unindexed branch"))
					}
				}
				persist(batch)
				check(false)
				for i := range batch.Observations {
					if batch.Observations[i].Kind == "holderEpoch" && batch.Observations[i].Value["status"] != "0" {
						batch.Observations[i].Value["sourceBlockHash"] = sourceHash
					}
				}
				persist(batch)
				check(true)
				for i := range batch.Observations {
					o := &batch.Observations[i]
					if o.Kind != "holderEpoch" {
						continue
					}
					old := o.Value["sourceBlockHash"]
					o.Value["sourceBlockHash"] = deployment.Hash([]byte("different source branch"))
					persist(batch)
					check(false)
					o.Value["sourceBlockHash"] = old
					persist(batch)
					check(true)
					break
				}
			}
			for i := range batch.Observations {
				o := &batch.Observations[i]
				field := "lastFundingAt"
				if mode == "epoch" {
					field = "sourceBlockNumber"
				}
				old, ok := o.Value[field]
				if !ok {
					continue
				}
				o.Value[field] = "101"
				persist(batch)
				check(false)
				o.Value[field] = old
				persist(batch)
				check(true)
				break
			}
			for i := range batch.Observations {
				o := &batch.Observations[i]
				if o.Kind != "treasurySolvency" {
					continue
				}
				old := o.Value["balance"]
				o.Value["balance"] = "0"
				persist(batch)
				check(false)
				o.Value["balance"] = old
				persist(batch)
				check(true)
				missing := batch
				missing.Observations = append(append([]deployment.StateObservation{}, batch.Observations[:i]...), batch.Observations[i+1:]...)
				missing.Expected = len(missing.Observations)
				persist(missing)
				check(false)
				persist(batch)
				check(true)
				break
			}
			if mode == "epoch" {
				// Finalization releases the fee into credit; it does not discharge debt.
				// Keep balance arithmetic valid so only the event-derived lower bound fails.
				for i := range batch.Observations {
					o := &batch.Observations[i]
					if o.Kind != "treasurySolvency" {
						continue
					}
					oldService, oldRequired := o.Value["totalServiceLiability"], o.Value["requiredBalance"]
					o.Value["totalServiceLiability"] = "0"
					o.Value["requiredBalance"] = o.Value["totalQuoteLiability"]
					persist(batch)
					check(false)
					o.Value["totalServiceLiability"], o.Value["requiredBalance"] = oldService, oldRequired
					persist(batch)
					check(true)
					break
				}
				native := "0x" + strings.Repeat("0", 40)
				distributor := ""
				for i := range batch.Observations {
					o := &batch.Observations[i]
					if o.Kind == "holderMarket" {
						distributor = o.Value["treasuryDistributor"].(string)
					}
					if o.Kind == "holderEpoch" && o.Value["status"] == "3" {
						o.Value["serviceFeeAsset"] = native
					}
				}
				// Adding solvency cannot legitimize changing the historical fee asset
				// when RootRequested committed a different asset.
				persist(batch)
				check(false)
				batch.Observations = append(batch.Observations, deployment.StateObservation{Kind: "treasurySolvency", Key: distributor + ":" + native, Value: map[string]any{"treasuryDistributor": distributor, "asset": native, "totalQuoteLiability": "0", "totalServiceLiability": "0", "knownHolderMarketOutstanding": "0", "requiredBalance": "0", "balance": "0"}})
				batch.Expected = len(batch.Observations)
				persist(batch)
				check(false)
			}

		})
	}

}
