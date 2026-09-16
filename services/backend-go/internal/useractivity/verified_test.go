package useractivity

import (
	"context"
	"errors"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type identityObserver struct{ block, genesis string }

func (o identityObserver) ChainID(context.Context) (uint64, error) { return 4663, nil }
func (o identityObserver) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	hash := o.block
	if tag == "0x0" {
		hash = o.genesis
	}
	return chainrpc.Header{Number: tag, Hash: hash}, nil
}
func (o identityObserver) CodeAt(context.Context, string, string) ([]byte, error) {
	return []byte{0}, nil
}

func TestVerifiedReceiptEnforcesEmitterBlockAndChain(t *testing.T) {
	ctx := context.Background()
	hash := "0x" + strings.Repeat("1", 64)
	genesis := "0x" + strings.Repeat("2", 64)
	address := "0x" + strings.Repeat("3", 40)
	account := "0x" + strings.Repeat("4", 40)
	m := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 4663, GenesisHash: genesis, Contracts: []deployment.Contract{{Module: "UserStockVault", Address: address, RuntimeCodeHash: deployment.Hash([]byte{0})}}}
	verified, err := deployment.Verify(ctx, identityObserver{hash, genesis}, m, chainrpc.Header{Number: "0x1", Hash: hash})
	if err != nil {
		t.Fatal(err)
	}
	log := chainrpc.Log{Address: address, BlockNumber: "0x1", BlockHash: hash, TransactionHash: genesis, TransactionIndex: "0x0", LogIndex: "0x0", Topics: []string{deployment.Hash([]byte("StockDeposited(bytes32,address,uint256)")), genesis, "0x" + strings.Repeat("0", 24) + account[2:]}, Data: "0x" + strings.Repeat("0", 63) + "1"}
	receipt := chainrpc.Receipt{BlockHash: hash, BlockNumber: "0x1", TransactionHash: genesis, TransactionIndex: "0x0", Status: "0x1", Logs: []chainrpc.Log{log}}
	records, err := FromVerifiedReceipt(ctx, 4663, verified, &receipt)
	if err != nil || len(records) != 1 || records[0].Account != account || records[0].Arguments["amount"] != "1" {
		t.Fatalf("%+v %v", records, err)
	}
	if _, err = FromVerifiedReceipt(ctx, 46630, verified, &receipt); !errors.Is(err, ErrEvidence) {
		t.Fatal(err)
	}
	wrong := receipt
	wrong.BlockHash = genesis
	wrong.Logs = []chainrpc.Log{log}
	wrong.Logs[0].BlockHash = genesis
	if result, err := FromVerifiedReceipt(ctx, 4663, verified, &wrong); err == nil || result != nil {
		t.Fatal("cross-block verification accepted")
	}
	unbound := receipt
	unbound.Logs = []chainrpc.Log{log}
	unbound.Logs[0].Address = account
	if records, err := FromVerifiedReceipt(ctx, 4663, verified, &unbound); err != nil || len(records) != 0 {
		t.Fatal("unbound emitter attributed", err)
	}
	// A valid first event must not leak if a later bound event is malformed.
	broken := receipt
	broken.Logs = []chainrpc.Log{log, log}
	broken.Logs[1].LogIndex = "0x1"
	broken.Logs[1].Data = "0x"
	if records, err := FromVerifiedReceipt(ctx, 4663, verified, &broken); err == nil || records != nil {
		t.Fatal("partial extraction leaked")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := FromVerifiedReceipt(cancelled, 4663, verified, &receipt); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestEmptyReceiptStillRequiresVerifiedScope(t *testing.T) {
	r := &chainrpc.Receipt{TransactionHash: "0x" + strings.Repeat("1", 64), TransactionIndex: "0x0", BlockHash: "0x" + strings.Repeat("2", 64), BlockNumber: "0x1", Status: "0x1", Logs: []chainrpc.Log{}}
	if result, err := FromVerifiedReceipt(context.Background(), 4663, deployment.Verified{}, r); err == nil || result != nil {
		t.Fatal("empty receipt bypassed identity verification")
	}
}
