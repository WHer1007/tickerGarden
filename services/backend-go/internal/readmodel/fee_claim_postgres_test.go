package readmodel

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/projection"
)

// Extend the synthetic replay fixture without changing its financial getters.
// This verifies paid-history export only, never a full cash-flow reconciliation.
func testFeeClaimReplay(t *testing.T, ctx context.Context, store ObservationStore, receipt chainrpc.Receipt, inputCount int, c CandidateSet, exec func(string, ...any)) {
	t.Helper()
	data, err := os.ReadFile("../projection/testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct{ Input projection.Input }
	if json.Unmarshal(data, &fixtures) != nil {
		t.Fatal("fixtures")
	}
	var base projection.Input
	for _, fixture := range fixtures {
		decoded, e := events.Decode(fixture.Input.Module, fixture.Input.Log)
		if e == nil && strings.HasPrefix(decoded.Signature, "FeeClaimed(") {
			base = fixture.Input
			break
		}
	}
	if base.Module == "" {
		t.Fatal("FeeClaimed missing")
	}
	original, _ := json.Marshal(receipt)
	originalDigest, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
	if err != nil {
		t.Fatal(err)
	}
	start := len(receipt.Logs)
	market := c.Markets[0]
	user := c.Positions[0].User
	inputs := []projection.Input{}
	word := func(v string) string {
		return strings.Repeat("0", 64-len(strings.TrimPrefix(v, "0x"))) + strings.TrimPrefix(v, "0x")
	}
	for i := 0; i < 2; i++ {
		in := base
		in.Observations = nil
		in.ChainID = store.ChainID
		in.Log.BlockHash = receipt.BlockHash
		in.Log.BlockNumber = receipt.BlockNumber
		in.Log.TransactionHash = receipt.TransactionHash
		in.Log.TransactionIndex = receipt.TransactionIndex
		in.Log.LogIndex = fmt.Sprintf("0x%x", start+i)
		in.Log.Topics = []string{base.Log.Topics[0], "0x" + word("1"), "0x" + word(user), market.MarketID}
		in.Log.Data = "0x" + word("0") + word(market.QuoteAsset) + word(fmt.Sprintf("%x", i+1))
		inputs = append(inputs, in)
		receipt.Logs = append(receipt.Logs, in.Log)
	}
	defer func() {
		exec(`DELETE FROM tickergarden.projection_inputs WHERE chain_id=$1 AND block_hash=$2 AND log_index >= $3`, store.ChainID, receipt.BlockHash, start)
		exec(`DELETE FROM tickergarden.chain_logs WHERE chain_id=$1 AND block_hash=$2 AND log_index >= $3`, store.ChainID, receipt.BlockHash, start)
		exec(`UPDATE tickergarden.chain_receipts SET payload=$1 WHERE chain_id=$2 AND block_hash=$3`, original, store.ChainID, receipt.BlockHash)
		exec(`UPDATE tickergarden.chain_blocks SET receipt_set_hash=$1 WHERE chain_id=$2 AND hash=$3`, originalDigest, store.ChainID, receipt.BlockHash)
		exec(`UPDATE tickergarden.projection_checkpoints SET input_count=$1 WHERE chain_id=$2`, inputCount, store.ChainID)
	}()
	for _, in := range inputs {
		raw, _ := json.Marshal(in)
		log, _ := json.Marshal(in.Log)
		index, err := chainrpc.Quantity(in.Log.LogIndex)
		if err != nil {
			t.Fatal(err)
		}
		exec(`INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) VALUES($1,$2,$3,$4,$5)`, store.ChainID, receipt.BlockHash, index, in.Log.Address, log)
		exec(`INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES($1,$2,$3,$4,$5)`, store.ChainID, receipt.BlockHash, index, raw, deployment.Hash(raw))
	}
	payload, _ := json.Marshal(receipt)
	digest, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
	if err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE tickergarden.chain_receipts SET payload=$1 WHERE chain_id=$2 AND block_hash=$3`, payload, store.ChainID, receipt.BlockHash)
	exec(`UPDATE tickergarden.chain_blocks SET receipt_set_hash=$1 WHERE chain_id=$2 AND hash=$3`, digest, store.ChainID, receipt.BlockHash)
	exec(`UPDATE tickergarden.projection_checkpoints SET input_count=$1 WHERE chain_id=$2`, inputCount+2, store.ChainID)
	result, err := store.LoadCandidateSet(ctx)
	if err != nil || len(result.FeeClaims) != 1 {
		t.Fatal("database fee claim export", err)
	}
	claim := result.FeeClaims[0]
	if claim.ClaimedAmount != "3" || claim.ClaimCount != "2" || claim.Beneficiary != user || claim.FeeAsset != market.QuoteAsset || claim.Source.LogIndex != uint64(start+1) || result.PublicationEligible {
		t.Fatal("fee claim values", claim)
	}
	exec(`DELETE FROM tickergarden.projection_inputs WHERE chain_id=$1 AND block_hash=$2 AND log_index=$3`, store.ChainID, receipt.BlockHash, start+1)
	if _, err = store.LoadCandidateSet(ctx); err == nil {
		t.Fatal("missing claim input accepted")
	}
}
