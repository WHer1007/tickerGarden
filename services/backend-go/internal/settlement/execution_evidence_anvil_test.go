package settlement

import (
	"context"
	"encoding/json"
	"github.com/ethereum/go-ethereum/crypto"
	"math/big"
	"net/url"
	"os"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"time"
)

func TestLocalFeeVaultExecutionEvidence(t *testing.T) {
	localFeeVaultEvidence(t)
}
func localFeeVaultEvidence(t *testing.T) (IntentRecord, ConversionPreview, ReceiptGaugeStorage, *chainrpc.Client, string) {
	path := os.Getenv("TG_LOCAL_EXECUTION_FIXTURE")
	if path == "" {
		t.Skip("isolated script fixture required")
	}
	var f struct {
		URL, TransactionHash, Sender, User, Vault, Meme, Quote, Hook, Market, Data, Gauge, RawTransaction string
		Staker                                                                                            bool
		Mature                                                                                            bool
		Deadline                                                                                          int64
	}
	raw, e := os.ReadFile(path)
	if e != nil || json.Unmarshal(raw, &f) != nil {
		t.Fatal("fixture", e)
	}
	u, e := url.Parse(f.URL)
	if e != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" {
		t.Fatal("local RPC required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	rpc, e := chainrpc.New(f.URL)
	if e != nil {
		t.Fatal(e)
	}
	receipt, e := rpc.TransactionReceipt(ctx, f.TransactionHash)
	if e != nil || receipt == nil {
		t.Fatal("receipt", e)
	}
	h, e := rpc.Header(ctx, receipt.BlockNumber)
	if e != nil {
		t.Fatal(e)
	}
	head, e := rpc.Header(ctx, "latest")
	if e != nil {
		t.Fatal(e)
	}
	finalized, e := rpc.Header(ctx, "finalized")
	if e != nil {
		t.Fatal(e)
	}
	genesis, e := rpc.Header(ctx, "0x0")
	if e != nil {
		t.Fatal(e)
	}
	code, e := rpc.CodeAt(ctx, f.Vault, h.Hash)
	if e != nil {
		t.Fatal(e)
	}
	in, _, _ := receiptEventFixture(t)
	in.Intent.ChainID = 46630
	in.Intent.GenesisHash = genesis.Hash
	in.Intent.JobKey = strings.Repeat("1", 64)
	in.Intent.Call.From = f.Sender
	in.Intent.Call.To = f.Vault
	in.Intent.Call.Data = f.Data
	in.Intent.Call.Value = "0x0"
	p := ConversionPreview{To: f.Vault, Candidate: ObservedCandidate{Plan: &Plan{Batches: []Batch{{MarketID: f.Market, Items: []Item{{User: f.User, CreatorEpoch: 1, MaximumMeme: "5"}}, MinimumQuote: "99", Deadline: f.Deadline}}}, State: deployment.RewardConversionState{FeeVault: f.Vault, FeeVaultRuntimeCodeHash: crypto.Keccak256Hash(code).Hex(), MemeToken: f.Meme, QuoteAsset: f.Quote}}}
	p.Route.Hook = f.Hook
	if f.Staker {
		p.Candidate.Plan.Batches[0].Items[0].CreatorEpoch = 0
		p.Candidate.State.MarketID = f.Market
		p.Candidate.State.Gauge = f.Gauge
		code, err := rpc.CodeAt(ctx, f.Gauge, h.Hash)
		if err != nil {
			t.Fatal(err)
		}
		p.Candidate.State.GaugeRuntimeCodeHash = crypto.Keccak256Hash(code).Hex()
	}
	o := ReceiptObservation{JobKey: in.Intent.JobKey, TransactionHash: f.TransactionHash, ChainID: 46630, GenesisHash: genesis.Hash, Head: head, Finalized: finalized, Receipt: receipt, Status: "finalized_success"}
	raw, _ = json.Marshal(o)
	r := ReceiptRecord{Sequence: 1, Digest: receiptDigest(raw), Observation: o}
	m, e := matchReceiptEvents(in, p, o)
	if e != nil {
		t.Fatal("events", e)
	}
	m.ReceiptSequence = 1
	m.ReceiptDigest = r.Digest
	tr, e := rpc.TransactionCallTrace(ctx, f.TransactionHash)
	if e != nil {
		t.Fatal("call trace", e)
	}
	state, e := rpc.TransactionState(ctx, f.TransactionHash)
	if e != nil {
		t.Fatal("state trace", e)
	}
	calls, e := matchTraceAccounting(p, m, tr)
	if e != nil {
		t.Fatal("calls", e)
	}
	creator, e := matchCreatorStorage(p, m, calls, state)
	if e != nil {
		t.Fatal("creator", e)
	}
	liabilities, e := matchLiabilityStorage(p, m, state)
	if e != nil {
		t.Fatal("liabilities", e)
	}
	stamp, _ := h.Time()
	gauge, e := matchGaugeStorage(p, m, calls, state, stamp)
	if e != nil {
		t.Fatal("gauge", e)
	}
	activation, e := matchGaugeActivation(p, state, gauge, stamp)
	if e != nil {
		t.Fatal("activation", e)
	}
	remainder, e := matchGaugeRemainders(p, state, gauge, tr)
	if e != nil {
		t.Fatal("remainder", e)
	}
	balances, e := matchAssetBalances(p, m, calls, creator, liabilities, tr, state)
	if e != nil {
		t.Fatal("balances", e)
	}
	ev := ReceiptGaugeStorage{Block: h, Evidence: ReceiptLiabilityStorage{Evidence: ReceiptCreatorStorage{Evidence: ReceiptAccounting{Evidence: ReceiptTrace{Receipt: r, Events: m, Trace: tr}, Accounting: calls}, State: state, CreatorStorage: creator}, Liabilities: liabilities}, Gauge: gauge, Activation: activation, Remainders: remainder, Balances: balances}
	if replayExecutionEvidence(in, p, ev) != nil {
		t.Fatal("full replay")
	}
	raw, _ = json.Marshal(ev)
	var restored ReceiptGaugeStorage
	if json.Unmarshal(raw, &restored) != nil || replayExecutionEvidence(in, p, restored) != nil {
		t.Fatal("round trip")
	}
	if !f.Staker && (len(creator.Items) != 1 || creator.Items[0].PulledMeme != "3" || creator.Items[0].MemeRefund != "2" || creator.Items[0].QuoteAfter != "110") {
		t.Fatal("actual partial fill", creator)
	}
	if f.Staker {
		if !gauge.PositionsMatched || !gauge.ParticipantSnapshotsMatched || len(gauge.Items) != 1 || len(calls.GaugeItems) != 1 || calls.GaugeItems[0].MemeRefund != "2" || gauge.Items[0].PulledMeme != "3" || gauge.Items[0].After.Rewards[0].Pending != "110" || gauge.Items[0].After.Rewards[1].Pending != "2" {
			t.Fatal("staker accounting", gauge, calls)
		}
		if gauge.Items[0].Materialized != f.Mature || gauge.Items[0].Before.UnlockAt != gauge.Items[0].After.UnlockAt {
			t.Fatal("activation/lock", gauge)
		}
		if f.Mature && (gauge.Items[0].After.Active != "2" || gauge.Items[0].After.Pending != "0" || activation.ActivatedStock != "1") {
			t.Fatal("mature totals", gauge, activation)
		}
	}
	// Reject changed observations even if a caller recomputes the container hash.
	for _, mode := range []string{"balance", "trace", "beneficiary-slot", "runtime"} {
		t.Run(mode, func(t *testing.T) {
			var changed ReceiptGaugeStorage
			if json.Unmarshal(raw, &changed) != nil {
				t.Fatal("decode")
			}
			switch mode {
			case "balance":
				changed.Balances.Assets[0].After = "100"
			case "trace":
				changed.Evidence.Evidence.Evidence.Evidence.Trace.Output = "0x" + eventWord("2") + eventWord("64")
			case "beneficiary-slot":
				if f.Staker {
					var layout gaugeStorageLayout
					if json.Unmarshal(gaugeStorageJSON, &layout) != nil {
						t.Fatal("layout")
					}
					key, ok := new(big.Int).SetString(f.User[2:], 16)
					if !ok {
						t.Fatal("user")
					}
					base, err := gaugeMappingSlot(layout.Positions, key)
					if err != nil {
						t.Fatal(err)
					}
					slot, err := gaugeSlot(base, 7)
					if err != nil {
						t.Fatal(err)
					}
					changed.Evidence.Evidence.State.Diff.Post[f.Gauge].Storage[slot] = "0x" + eventWord("3")
					break
				}
				var layout feeVaultLayout
				if json.Unmarshal(feeVaultStorageJSON, &layout) != nil {
					t.Fatal("layout")
				}
				slot, err := creatorLiabilitySlot(layout, f.Market, 1, f.Meme)
				if err != nil {
					t.Fatal(err)
				}
				changed.Evidence.Evidence.State.Diff.Post[f.Vault].Storage[slot] = "0x" + eventWord("3")
			case "runtime":
				a := changed.Evidence.Evidence.State.Prestate[f.Vault]
				badCode := "0x00"
				a.Code = &badCode
				changed.Evidence.Evidence.State.Prestate[f.Vault] = a
			}
			if replayExecutionEvidence(in, p, changed) == nil {
				t.Fatal("modified observation accepted")
			}
		})
	}
	t.Log("actual FeeVault: maximum 5, pull 3, spend 1, refund 2, quote 100; runtime, events, state and balances replayed")
	return in, p, ev, rpc, f.RawTransaction
}
