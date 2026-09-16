package holderledger

import (
	"context"
	"strconv"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type BlockReplayRPC interface {
	ReconcileRPC
	AuthenticatedTransactions(context.Context, uint64, string) (chainrpc.TransactionBlock, error)
	Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error)
	TransactionCallTrace(context.Context, string) (chainrpc.CallTrace, error)
}
type BlockReplay struct {
	Block               chainrpc.Header `json:"block"`
	Transactions        int             `json:"transactions"`
	Actions             int             `json:"actions"`
	EvidenceDigest      string          `json:"evidenceDigest"`
	HistoryVerified     bool            `json:"historyVerified"`
	PublicationEligible bool            `json:"publicationEligible"`
}

// ReplayNextBlock consumes every transaction of the next finalized block,
// including no-log transactions. Use chainrpc.RootVerifiedClient in production.
// On any missing/unsupported evidence or reorg, the ledger remains unchanged.
// Parent is an externally authenticated end-of-block seed, not an inferred
// creation boundary. Neither a provider trace nor this one-block report proves
// complete history from registration, so both eligibility flags remain false.
func (l *Ledger) ReplayNextBlock(ctx context.Context, rpc BlockReplayRPC, c ReconcileConfig, parent, block chainrpc.Header) (BlockReplay, error) {
	fail := func() (BlockReplay, error) { return BlockReplay{}, ErrReconciliation }
	if l == nil || rpc == nil || c.ChainID == 0 || !hash.MatchString(c.GenesisHash) || !hash.MatchString(c.TokenCodeHash) || !hash.MatchString(c.DistributorCodeHash) || !hash.MatchString(block.Hash) || !hash.MatchString(parent.Hash) || !address.MatchString(c.Binding.Distributor) || !address.MatchString(c.Binding.Vault) || c.Binding.Distributor == zero || c.Binding.Vault == zero || c.Binding.Distributor == c.Binding.Vault || c.MaxAccounts < 1 || c.MaxAccounts > 10000 || len(l.Accounts) > c.MaxAccounts {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if ctx.Err() != nil {
		return fail()
	}
	n, e := block.Height()
	if e != nil || n == 0 {
		return fail()
	}
	pn, e := parent.Height()
	if e != nil || pn != n-1 || block.ParentHash != parent.Hash {
		return fail()
	}
	ts, e := block.Time()
	if e != nil {
		return fail()
	}
	pts, e := parent.Time()
	if e != nil || ts < pts || l.UpdatedAt > pts {
		return fail()
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != c.ChainID {
		return fail()
	}
	gen, e := rpc.Header(ctx, "0x0")
	if e != nil || gen.Hash != c.GenesisHash {
		return fail()
	}
	p, e := rpc.Header(ctx, parent.Number)
	if e != nil || p != parent {
		return fail()
	}
	f, e := rpc.Header(ctx, "finalized")
	if e != nil {
		return fail()
	}
	fn, e := f.Height()
	if e != nil || fn < n {
		return fail()
	}
	for _, h := range []string{parent.Hash, block.Hash} {
		for _, v := range []struct{ a, h string }{{l.Token, c.TokenCodeHash}, {c.Binding.Distributor, c.DistributorCodeHash}} {
			code, e := rpc.CodeAt(ctx, v.a, h)
			if e != nil || len(code) == 0 || deployment.Hash(code) != v.h {
				return fail()
			}
		}
	}
	txs, e := rpc.AuthenticatedTransactions(ctx, c.ChainID, block.Hash)
	if e != nil || txs.Header != block || !hash.MatchString(txs.ReceiptRoot) || len(txs.Transactions) > 256 {
		return fail()
	}
	o, e := rpc.Observe(ctx, block)
	if e != nil || o.RootProof == nil || o.RootProof.BlockHash != block.Hash || o.RootProof.ReceiptRoot != txs.ReceiptRoot || o.RootProof.ReceiptCount != len(txs.Transactions) || len(o.Receipts) != len(txs.Transactions) {
		return fail()
	}
	commit, e := chainrpc.ReceiptSetCommitment(o.Receipts)
	if e != nil || commit != o.RootProof.ReceiptSetHash {
		return fail()
	}
	next := l.clone()
	out := BlockReplay{Block: block, Transactions: len(txs.Transactions)}
	traces := make([]TransactionTrace, 0, len(txs.Transactions))
	for i, tx := range txs.Transactions {
		if ctx.Err() != nil {
			return fail()
		}
		r := o.Receipts[i]
		if chainrpc.ValidateTransactionReceipt(tx.Hash, &r) != nil || r.BlockHash != block.Hash || r.BlockNumber != block.Number || r.TransactionIndex != "0x"+strconv.FormatInt(int64(i), 16) {
			return fail()
		}
		trace, e := rpc.TransactionCallTrace(ctx, tx.Hash)
		if e != nil || chainrpc.ValidateCallTrace(trace) != nil {
			return fail()
		}
		traces = append(traces, TransactionTrace{TransactionHash: tx.Hash, Trace: trace})
		wantType := "CALL"
		if tx.Creation {
			wantType = "CREATE"
		}
		value := trace.Value
		if value == "" {
			value = "0x0"
		}
		if trace.Type != wantType || trace.From != tx.From || trace.To != tx.To || trace.Input != tx.Input || value != tx.Value || (trace.Error == "") != (r.Status == "0x1") {
			return fail()
		}
		count, e := next.ApplyTrace(ts, c.Binding, trace)
		if e != nil || len(next.Accounts) > c.MaxAccounts {
			return fail()
		}
		out.Actions += count
	}
	// Recheck the same parent, target and finalized anchor before exposing state.
	for _, want := range []chainrpc.Header{parent, block, f} {
		h, e := rpc.Header(ctx, want.Number)
		if e != nil || h != want {
			return fail()
		}
	}
	id, e = rpc.ChainID(ctx)
	if e != nil || id != c.ChainID {
		return fail()
	}
	gen, e = rpc.Header(ctx, "0x0")
	if e != nil || gen.Hash != c.GenesisHash || ctx.Err() != nil {
		return fail()
	}
	out.EvidenceDigest, e = replayEvidenceDigest(parent, block, c, commit, l, txs.Transactions, traces)
	if e != nil {
		return fail()
	}
	*l = *next
	return out, nil
}
