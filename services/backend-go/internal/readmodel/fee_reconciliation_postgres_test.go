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
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

func testFeeReconciliationReplay(t *testing.T, ctx context.Context, store ObservationStore, receipt chainrpc.Receipt, originalInputs []projection.Input, batch deployment.ObservationBatch, persist func(deployment.ObservationBatch), exec func(string, ...any)) {
	t.Helper()
	for _, mode := range []string{"continuous", "epoch"} {
		t.Run("fee-"+mode, func(t *testing.T) {
			testFeeReconciliationMode(t, ctx, store, receipt, originalInputs, batch, persist, exec, mode)
		})
	}
}

func testFeeReconciliationMode(t *testing.T, ctx context.Context, store ObservationStore, receipt chainrpc.Receipt, originalInputs []projection.Input, batch deployment.ObservationBatch, persist func(deployment.ObservationBatch), exec func(string, ...any), mode string) {
	t.Helper()
	originalBatch, _ := json.Marshal(batch)
	var b deployment.ObservationBatch
	if json.Unmarshal(originalBatch, &b) != nil {
		t.Fatal("clone")
	}
	originalInputs = append([]projection.Input{}, originalInputs...)
	creationBefore, _ := json.Marshal(originalInputs[4])
	var discoveryBefore []byte
	if store.Pool.QueryRow(ctx, `SELECT payload FROM tickergarden.discovered_markets WHERE chain_id=$1`, store.ChainID).Scan(&discoveryBefore) != nil {
		t.Fatal("original discovery")
	}
	vault := fmt.Sprintf("0x%040x", 2000)
	distributor := fmt.Sprintf("0x%040x", 2001)
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: store.ChainID, GenesisHash: store.GenesisHash}
	for _, in := range originalInputs[:5] {
		manifest.Contracts = append(manifest.Contracts, deployment.Contract{Module: in.Module, Address: in.Log.Address, RuntimeCodeHash: deployment.Hash([]byte(in.Module))})
	}
	manifest.Contracts = append(manifest.Contracts, deployment.Contract{Module: "ProtocolFeeVault", Address: vault, RuntimeCodeHash: deployment.Hash([]byte("fee fixture"))})
	holderModule := "HolderRewardsDistributorV1"
	if mode == "epoch" {
		holderModule = "TreasuryDistributorV1"
	}
	manifest.Contracts = append(manifest.Contracts, deployment.Contract{Module: holderModule, Address: distributor, RuntimeCodeHash: deployment.Hash([]byte("holder fixture"))})
	oldHash := store.ManifestHash
	store.ManifestHash = candidateManifestHash(manifest)
	store.EmitterManifest = &manifest
	originalReceipt, _ := json.Marshal(receipt)
	originalDigest, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
	if err != nil {
		t.Fatal(err)
	}
	start := len(receipt.Logs)
	defer func() {
		exec(`UPDATE tickergarden.projection_inputs SET payload=$1,digest=$2 WHERE chain_id=$3 AND log_index=4`, creationBefore, deployment.Hash(creationBefore), store.ChainID)
		exec(`UPDATE tickergarden.discovered_markets SET payload=$1 WHERE chain_id=$2`, discoveryBefore, store.ChainID)
		exec(`DELETE FROM tickergarden.projection_inputs WHERE chain_id=$1 AND log_index >= $2`, store.ChainID, start)
		exec(`DELETE FROM tickergarden.chain_logs WHERE chain_id=$1 AND log_index >= $2`, store.ChainID, start)
		exec(`UPDATE tickergarden.chain_receipts SET payload=$1 WHERE chain_id=$2`, originalReceipt, store.ChainID)
		exec(`UPDATE tickergarden.chain_blocks SET receipt_set_hash=$1,receipts_root=NULL,root_receipt_set_hash=NULL WHERE chain_id=$2`, originalDigest, store.ChainID)
		exec(`UPDATE tickergarden.projection_checkpoints SET input_count=$1,manifest_hash=$2 WHERE chain_id=$3`, len(originalInputs), oldHash, store.ChainID)
		exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=$2`, oldHash, store.ChainID)
		persist(batch)
	}()
	var id, meme, quote, user, quoteCreator string
	for _, o := range b.Observations {
		if o.Kind == "market" {
			id = o.Key
			o.Value["creatorFeesToHolders"] = true
			originalInputs[4].Observations = []projection.Observation{{Kind: "market", Key: id, Value: projection.Row(o.Value)}}
			meme = o.Value["memeToken"].(string)
			quote = o.Value["quoteAsset"].(string)
		}
		if o.Kind == "gaugePosition" {
			user = o.Value["user"].(string)
		}
	}
	for _, o := range b.Observations {
		if o.Kind == "feeLiability" || o.Kind == "feeSolvency" {
			o.Value["feeVault"] = vault
		}
		if o.Kind == "feeLiability" && o.Value["feeAsset"] == quote {
			quoteCreator = o.Value["creator"].(string)
		}
	}
	creationData, _ := json.Marshal(originalInputs[4])
	var discovery deployment.MarketDiscovery
	if json.Unmarshal(discoveryBefore, &discovery) != nil {
		t.Fatal("discovery clone")
	}
	discovery.State = map[string]any(originalInputs[4].Observations[0].Value)
	discoveryData, _ := json.Marshal(discovery)
	exec(`UPDATE tickergarden.projection_inputs SET payload=$1,digest=$2 WHERE chain_id=$3 AND log_index=4`, creationData, deployment.Hash(creationData), store.ChainID)
	exec(`UPDATE tickergarden.discovered_markets SET payload=$1 WHERE chain_id=$2`, discoveryData, store.ChainID)
	streamRaw, err := os.ReadFile("testdata/holders/" + mode + ".json")
	if err != nil {
		t.Fatal(err)
	}
	var streamBatch deployment.ObservationBatch
	if json.Unmarshal(streamRaw, &streamBatch) != nil {
		t.Fatal("stream fixture")
	}
	for _, o := range streamBatch.Observations {
		if o.Kind == "holderMarket" {
			o.Key = id
			o.Value["marketId"] = id
			o.Value["token"] = meme
			o.Value["quote"] = quote
			o.Value["vault"] = vault
			o.Value["treasuryDistributor"] = distributor
			o.Value["lastFundingAt"] = "100"
			if mode == "epoch" {
				delete(o.Value, "lastFundingAt")
				delete(o.Value, "token")
				delete(o.Value, "quote")
				delete(o.Value, "vault")
				o.Value["memeToken"] = meme
				o.Value["quoteToken"] = quote
				o.Value["currentServiceFeeAsset"] = quote
				o.Value["epochDuration"] = "50"
			}
			b.Observations = append(b.Observations, o)
		} else if o.Kind == "treasurySolvency" {
			o.Key = distributor + ":" + quote
			o.Value["asset"] = quote
			o.Value["treasuryDistributor"] = distributor
			for _, field := range []string{"balance", "knownHolderMarketOutstanding", "requiredBalance", "totalQuoteLiability"} {
				o.Value[field] = "3"
			}
			o.Value["totalServiceLiability"] = "0"
			b.Observations = append(b.Observations, o)
		} else if o.Kind == "holderEpoch" && mode == "epoch" {
			epoch := o.Value["epoch"].(string)
			o.Key = id + ":" + epoch
			o.Value["marketId"] = id
			o.Value["treasuryDistributor"] = distributor
			o.Value["quoteAsset"] = quote
			o.Value["memeAsset"] = meme
			for _, field := range []string{"requestedAt", "publishBy", "finalizeAfter", "claimUntil", "sourceBlockNumber", "leafCount", "status", "serviceFeeAmount", "quoteAmount", "claimedAmount", "totalTwab", "fundedQuoteAmount", "outstandingQuoteAmount", "holderQuoteLiability", "holderMemeLiability"} {
				o.Value[field] = "0"
			}
			for _, field := range []string{"sourceBlockHash", "merkleRoot", "datasetHash"} {
				o.Value[field] = "0x" + strings.Repeat("0", 64)
			}
			o.Value["requester"] = "0x" + strings.Repeat("0", 40)
			o.Value["serviceFeeAsset"] = "0x" + strings.Repeat("0", 40)
			if epoch == "1" {
				o.Value["window"] = map[string]any{"start": "1", "end": "51"}
				o.Value["fundedQuoteAmount"] = "3"
				o.Value["outstandingQuoteAmount"] = "3"
			} else {
				o.Value["window"] = map[string]any{"start": "51", "end": "101"}
				o.Value["holderQuoteLiability"] = "5"
				o.Value["holderMemeLiability"] = "7"
			}
			b.Observations = append(b.Observations, o)
		}
	}
	b.Expected = len(b.Observations)
	for _, o := range b.Observations {
		if o.Kind == "feeLiability" {
			amount := "5"
			if o.Value["feeAsset"] == meme {
				amount = "7"
			}
			o.Value["holder"] = amount
			o.Value["bucketAndReserveTotal"] = feeTestAdd(t, o.Value["bucketAndReserveTotal"].(string), amount)
		} else if o.Kind == "feeSolvency" {
			amount := "5"
			if o.Key == meme {
				amount = "7"
			}
			for _, field := range []string{"totalLiability", "knownMarketLiabilitySum", "balance"} {
				o.Value[field] = feeTestAdd(t, o.Value[field].(string), amount)
			}
		}
	}
	raw, err := os.ReadFile("../events/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog events.Catalog
	if json.Unmarshal(raw, &catalog) != nil {
		t.Fatal("catalog")
	}
	inputs := []projection.Input{}
	add := func(name string, values map[string]string) {
		t.Helper()
		for _, def := range catalog.Events {
			if def.Name != name {
				continue
			}
			log := chainrpc.Log{Address: vault, BlockHash: receipt.BlockHash, BlockNumber: receipt.BlockNumber, TransactionHash: receipt.TransactionHash, TransactionIndex: receipt.TransactionIndex, LogIndex: fmt.Sprintf("0x%x", start+len(inputs)), Topics: []string{def.Topic0}, Data: "0x"}
			for _, field := range def.Inputs {
				v := values[field.Name]
				if field.Name == "feeId" {
					v = fmt.Sprintf("%d", len(inputs)+1)
				}
				if field.Name == "marketId" {
					v = id
				}
				if v == "" {
					v = "0"
				}
				base := 10
				if strings.HasPrefix(v, "0x") {
					base = 16
					v = v[2:]
				}
				n, ok := new(big.Int).SetString(v, base)
				if !ok || n.Sign() < 0 {
					t.Fatal(v)
				}
				word := fmt.Sprintf("%064x", n)
				if field.Indexed {
					log.Topics = append(log.Topics, "0x"+word)
				} else {
					log.Data += word
				}
			}
			module := "ProtocolFeeVault"
			if name == "HolderStreamMarketRegistered" || name == "HolderStreamFunded" {
				module = "HolderRewardsDistributorV1"
				log.Address = distributor
			}
			if name == "QuoteTreasuryFunded" {
				module = "TreasuryDistributorV1"
				log.Address = distributor
			}
			inputs = append(inputs, projection.Input{ChainID: store.ChainID, Module: module, Log: log})
			receipt.Logs = append(receipt.Logs, log)
			return
		}
		t.Fatal("missing event", name)
	}
	amount, _ := new(big.Int).SetString(quoteCreator, 10)
	amount.Div(amount, big.NewInt(2))
	secondEpoch := amount.String()
	amount.Sub(amount, big.NewInt(3))
	add("FeeBucketsCredited", map[string]string{"feeAsset": quote, "creatorEpoch": "1", "creatorAmount": amount.String(), "stakerAmount": "22"})
	add("FeeBucketsCredited", map[string]string{"feeAsset": quote, "creatorEpoch": "2", "creatorAmount": secondEpoch})
	add("FeeBucketsCredited", map[string]string{"feeAsset": meme, "creatorEpoch": "1", "creatorAmount": "2", "stakerAmount": "20"})
	add("FeeClaimed", map[string]string{"feeAsset": quote, "beneficiaryType": "1", "beneficiary": user, "amount": "2"})
	add("RewardConverted", map[string]string{"creatorEpoch": "1", "user": user, "memeSpent": "2", "quoteReceived": "3"})
	if mode == "continuous" {
		add("HolderStreamMarketRegistered", map[string]string{"token": meme, "quote": quote, "vault": vault})
	}
	add("HolderFeesAccrued", map[string]string{"epochId": "1", "feeAsset": quote, "amount": "1"})
	add("HolderFeesAccrued", map[string]string{"epochId": "1", "feeAsset": meme, "amount": "2"})
	add("HolderRewardsConverted", map[string]string{"epochId": "1", "memeAsset": meme, "quoteAsset": quote, "memeSpent": "2", "quoteReceived": "2"})
	fundingIndex := start + len(inputs)
	if mode == "continuous" {
		add("HolderStreamFunded", map[string]string{"amount": "3", "end": "86500"})
	} else {
		add("QuoteTreasuryFunded", map[string]string{"epochId": "1", "funder": vault, "quoteToken": quote, "amount": "3", "fundingId": "1"})
	}
	nextEpoch := "1"
	if mode == "epoch" {
		nextEpoch = "2"
	}
	add("HolderFeesAccrued", map[string]string{"epochId": nextEpoch, "feeAsset": quote, "amount": "5"})
	add("HolderFeesAccrued", map[string]string{"epochId": nextEpoch, "feeAsset": meme, "amount": "7"})
	state := projection.New()
	for _, in := range append(append([]projection.Input{}, originalInputs...), inputs...) {
		if _, err := state.Apply(in); err != nil {
			t.Fatal("fee fixture replay", err)
		}
	}
	for _, in := range inputs {
		payload, _ := json.Marshal(in)
		rawLog, _ := json.Marshal(in.Log)
		index, _ := chainrpc.Quantity(in.Log.LogIndex)
		exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,$3,$4,$5)`, store.ChainID, receipt.BlockHash, index, in.Log.Address, rawLog)
		exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,$3,$4,$5)`, store.ChainID, receipt.BlockHash, index, payload, deployment.Hash(payload))
	}
	payload, _ := json.Marshal(receipt)
	digest, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
	if err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE tickergarden.chain_receipts SET payload=$1 WHERE chain_id=$2`, payload, store.ChainID)
	// Synthetic roots bind the persisted inventory; this does not test RPC trie proofs.
	exec(`UPDATE tickergarden.chain_blocks SET receipt_set_hash=$1,receipts_root=$2,root_receipt_set_hash=$1 WHERE chain_id=$3`, digest, deployment.Hash([]byte("fee root fixture")), store.ChainID)
	exec(`UPDATE tickergarden.projection_checkpoints SET input_count=$1,manifest_hash=$2 WHERE chain_id=$3`, len(originalInputs)+len(inputs), store.ManifestHash, store.ChainID)
	exec(`UPDATE tickergarden.discovery_checkpoints SET manifest_hash=$1 WHERE chain_id=$2`, store.ManifestHash, store.ChainID)
	persist(b)
	check := func(status string) {
		t.Helper()
		got, err := store.LoadCandidateSet(ctx)
		if err != nil {
			t.Fatal("fee candidate", err)
		}
		r := got.FeeReconciliation
		if r == nil || r.Status != status || r.Report == nil || r.Report.PublicationEligible || r.Report.HistoryComplete || got.PublicationEligible || r.BlockHash != b.BlockHash || (status == "matched" && (!r.Report.MatchesKnownLiabilities || r.Report.Expected != 18)) {
			t.Fatal("fee reconciliation", r)
		}
		if r.CreatorEpochs == nil || r.CreatorEpochs.Status != "matched" || len(r.CreatorEpochs.Probes) != 4 {
			t.Fatal("creator epoch replay", r.CreatorEpochs)
		}
		if r.HolderEpochs == nil || r.HolderEpochs.Status != "matched" || len(r.HolderEpochs.Probes) != map[string]int{"continuous": 2, "epoch": 4}[mode] {
			t.Fatal("database Holder ledger", r.HolderEpochs)
		}
	}
	verifiedEpochs, err := store.LoadCandidateSet(ctx)
	if err != nil || VerifyCreatorEpochEvidence(verifiedEpochs) != nil {
		t.Fatal("database creator event evidence", err)
	}
	matchedBatch, _ := json.Marshal(b)
	check("matched")
	testFeeRPCPipeline(t, ctx, store, manifest, b)
	testHolderRPC(t, verifiedEpochs, vault, mode == "epoch")
	// Getter-internal sums can remain coherent while the Holder event debt differs.
	if mode == "epoch" {
		for _, o := range b.Observations {
			if o.Kind == "holderEpoch" && o.Value["epoch"] == "2" {
				o.Value["holderQuoteLiability"] = "6"
			}
		}
	}
	for _, o := range b.Observations {
		if o.Kind == "feeLiability" && o.Value["feeAsset"] == quote {
			o.Value["holder"] = "6"
			o.Value["bucketAndReserveTotal"] = feeTestAdd(t, o.Value["bucketAndReserveTotal"].(string), "1")
		}
		if o.Kind == "feeSolvency" && o.Key == quote {
			for _, field := range []string{"totalLiability", "knownMarketLiabilitySum", "balance"} {
				o.Value[field] = feeTestAdd(t, o.Value[field].(string), "1")
			}
		}
	}
	persist(b)
	wrongHolder, err := store.LoadCandidateSet(ctx)
	if err != nil || wrongHolder.FeeReconciliation == nil || wrongHolder.FeeReconciliation.Status != "mismatch" || wrongHolder.FeeReconciliation.HolderEpochs == nil || wrongHolder.FeeReconciliation.HolderEpochs.Status != "mismatch" {
		t.Fatal("Holder discrepancy hidden", err, wrongHolder.FeeReconciliation)
	}
	if VerifyHolderEpochRPC(ctx, nil, manifest, wrongHolder) == nil {
		t.Fatal("Holder discrepancy passed RPC preflight")
	}
	if json.Unmarshal(matchedBatch, &b) != nil {
		t.Fatal("restore Holder observations")
	}
	persist(b)
	check("matched")
	// Move one unit between epochs without changing the aggregate Creator bucket.
	for _, o := range b.Observations {
		if o.Kind == "creatorEpoch" {
			n, _ := new(big.Int).SetString(o.Value["quoteLiability"].(string), 10)
			if o.Value["epoch"] == "1" {
				n.Add(n, big.NewInt(1))
			} else {
				n.Sub(n, big.NewInt(1))
			}
			o.Value["quoteLiability"] = n.String()
		}
	}
	persist(b)
	shifted, err := store.LoadCandidateSet(ctx)
	if err != nil || shifted.FeeReconciliation == nil || shifted.FeeReconciliation.Status != "matched" || shifted.FeeReconciliation.CreatorEpochs == nil || shifted.FeeReconciliation.CreatorEpochs.Status != "mismatch" {
		t.Fatal("epoch shift hidden by aggregate", shifted.FeeReconciliation, err)
	}
	if VerifyCreatorEpochEvidence(shifted) == nil {
		t.Fatal("shifted epoch event evidence accepted")
	}
	if json.Unmarshal(matchedBatch, &b) != nil {
		t.Fatal("restore epoch observations")
	}
	persist(b)
	check("matched")
	// Keep getter sums internally coherent, but contradict the event-derived ledger.
	for _, o := range b.Observations {
		if o.Kind == "feeLiability" && o.Value["feeAsset"] == quote {
			o.Value["platform"] = "1"
			o.Value["bucketAndReserveTotal"] = feeTestAdd(t, o.Value["bucketAndReserveTotal"].(string), "1")
		}
		if o.Kind == "feeSolvency" && o.Key == quote {
			for _, f := range []string{"totalLiability", "knownMarketLiabilitySum", "balance"} {
				o.Value[f] = feeTestAdd(t, o.Value[f].(string), "1")
			}
		}
	}
	persist(b)
	check("mismatch")
	if json.Unmarshal(matchedBatch, &b) != nil {
		t.Fatal("restore matched observations")
	}
	persist(b)
	check("matched")
	exec(`DELETE FROM tickergarden.projection_inputs WHERE chain_id=$1 AND log_index=$2`, store.ChainID, fundingIndex)
	if _, err := store.LoadCandidateSet(ctx); err == nil {
		t.Fatal("missing Holder funding input accepted")
	}
	exec(`UPDATE tickergarden.projection_checkpoints SET input_count=$1 WHERE chain_id=$2`, len(originalInputs)+len(inputs)-1, store.ChainID)
	if _, err := store.LoadCandidateSet(ctx); err == nil {
		t.Fatal("missing Holder funding accepted with adjusted input count")
	}
}
