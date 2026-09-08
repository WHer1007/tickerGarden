package holderledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math/big"
	"sort"
	"strconv"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
)

var ErrReconciliation = errors.New("continuous holder reconciliation unavailable")

type ReconcileRPC interface {
	ChainID(context.Context) (uint64, error)
	Header(context.Context, string) (chainrpc.Header, error)
	CodeAt(context.Context, string, string) ([]byte, error)
	CallAt(context.Context, string, string, string) ([]byte, error)
}
type ReconcileConfig struct {
	ChainID             uint64  `json:"chainId"`
	GenesisHash         string  `json:"genesisHash"`
	Binding             Binding `json:"binding"`
	Quote               string  `json:"quote"`
	DistributorCodeHash string  `json:"distributorCodeHash"`
	TokenCodeHash       string  `json:"tokenCodeHash"`
	MaxAccounts         int     `json:"maxAccounts"`
}
type Reconciliation struct {
	Block                  chainrpc.Header `json:"block"`
	MarketID               string          `json:"marketId"`
	AccountsChecked        int             `json:"accountsChecked"`
	AccountInventoryDigest string          `json:"accountInventoryDigest"`
	FieldsMatched          bool            `json:"fieldsMatched"`
	Differences            []string        `json:"differences"`
	DifferenceCount        int             `json:"differenceCount"`
	PublicationEligible    bool            `json:"publicationEligible"`
}

// Reconcile compares the supplied replay to independently read finalized state.
// It does NOT authenticate the replay's initial state or prove complete history;
// even a perfect match leaves PublicationEligible false. All accounts in the
// replay are checked, including excluded balances. No sampling or latest fallback.
func (l *Ledger) Reconcile(ctx context.Context, rpc ReconcileRPC, c ReconcileConfig, block chainrpc.Header) (Reconciliation, error) {
	fail := func() (Reconciliation, error) { return Reconciliation{}, ErrReconciliation }
	if l == nil || rpc == nil || c.ChainID == 0 || !hash.MatchString(c.GenesisHash) || !hash.MatchString(block.Hash) || !hash.MatchString(c.TokenCodeHash) || !hash.MatchString(c.DistributorCodeHash) || !address.MatchString(c.Quote) || !address.MatchString(c.Binding.Distributor) || !address.MatchString(c.Binding.Vault) || c.Binding.Distributor == zero || c.Binding.Vault == zero || c.Binding.Distributor == c.Binding.Vault || c.Quote == l.Token || c.MaxAccounts < 1 || c.MaxAccounts > 10000 || len(l.Accounts) > c.MaxAccounts {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if ctx.Err() != nil {
		return fail()
	}
	ts, e := block.Time()
	if e != nil {
		return fail()
	}
	n, e := block.Height()
	if e != nil {
		return fail()
	}
	s, e := l.View(ts)
	if e != nil {
		return fail()
	}
	id, e := rpc.ChainID(ctx)
	if e != nil || id != c.ChainID {
		return fail()
	}
	g, e := rpc.Header(ctx, "0x0")
	if e != nil || g.Hash != c.GenesisHash {
		return fail()
	}
	h, e := rpc.Header(ctx, block.Number)
	if e != nil || h != block {
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
	for _, v := range []struct{ a, h string }{{l.Token, c.TokenCodeHash}, {c.Binding.Distributor, c.DistributorCodeHash}} {
		code, e := rpc.CodeAt(ctx, v.a, block.Hash)
		if e != nil || len(code) == 0 || deployment.Hash(code) != v.h {
			return fail()
		}
	}
	read := func(a, sig, args string, fields []events.Input) (map[string]any, error) {
		b, e := rpc.CallAt(ctx, a, selector(sig)+args, block.Hash)
		if e != nil {
			return nil, ErrReconciliation
		}
		return events.DecodeStatic(fields, b)
	}
	one := func(a, sig, args, typ string) (string, error) {
		v, e := read(a, sig, args, []events.Input{{Name: "value", Type: typ}})
		if e != nil {
			return "", e
		}
		s, ok := v["value"].(string)
		if !ok {
			return "", ErrReconciliation
		}
		return s, nil
	}
	for _, v := range []struct{ a, sig, args, typ, want string }{
		{l.Token, "treasuryDistributor()", "", "address", c.Binding.Distributor},
		{l.Token, "marketId()", "", "bytes32", l.MarketID},
		{c.Binding.Distributor, "rewardMode()", "", "bytes32", deployment.Hash([]byte("TICKERGARDEN_HOLDER_STREAM_24H_V1"))},
		{c.Binding.Distributor, "STREAM_DURATION()", "", "uint256", "86400"},
	} {
		got, e := one(v.a, v.sig, v.args, v.typ)
		if e != nil || got != v.want {
			return fail()
		}
	}
	// Compare the complete, bounded exclusion inventory; checking only known
	// eligible accounts would miss omitted exclusions.
	raw, e := rpc.CallAt(ctx, c.Binding.Distributor, selector("feeSharingExcludedAccounts(bytes32)")+l.MarketID[2:], block.Hash)
	if e != nil || len(raw) < 64 || len(raw) > 64+9*32 || new(big.Int).SetBytes(raw[:32]).Cmp(big.NewInt(32)) != 0 {
		return fail()
	}
	count := new(big.Int).SetBytes(raw[32:64])
	if !count.IsInt64() || int(count.Int64()) != len(l.Excluded) || len(raw) != 64+int(count.Int64())*32 {
		return fail()
	}
	seen := map[string]bool{}
	for i := 0; i < int(count.Int64()); i++ {
		a, e := addr(hex.EncodeToString(raw[64+i*32 : 96+i*32]))
		if e != nil || !l.Excluded[a] || seen[a] {
			return fail()
		}
		seen[a] = true
	}
	fields := []events.Input{}
	for _, v := range []struct{ n, t string }{{"token", "address"}, {"quote", "address"}, {"vault", "address"}, {"updatedAt", "uint64"}, {"head", "uint8"}, {"count", "uint8"}, {"supply", "uint256"}, {"index", "uint256"}, {"indexRemainder", "uint256"}, {"rate", "uint256"}, {"idle", "uint256"}, {"funded", "uint256"}, {"paid", "uint256"}} {
		fields = append(fields, events.Input{Name: v.n, Type: v.t})
	}
	market, e := read(c.Binding.Distributor, "marketState(bytes32)", l.MarketID[2:], fields)
	if e != nil {
		return fail()
	}
	if market["token"] != l.Token || market["quote"] != c.Quote || market["vault"] != c.Binding.Vault {
		return fail()
	}
	out := Reconciliation{Block: block, MarketID: l.MarketID, Differences: []string{}}
	compare := func(name, got, want string) {
		if got != want {
			out.DifferenceCount++
			if len(out.Differences) < 64 {
				out.Differences = append(out.Differences, name)
			}
		}
	}
	want := map[string]string{"updatedAt": strconv.FormatUint(s.UpdatedAt, 10), "head": strconv.Itoa(int(l.Head)), "count": strconv.Itoa(len(l.Streams)), "supply": s.Supply, "index": s.Index, "indexRemainder": s.IndexRemainder, "rate": s.Rate, "idle": s.Idle, "funded": s.Funded, "paid": s.Paid}
	for k, v := range want {
		got, ok := market[k].(string)
		if !ok {
			return fail()
		}
		compare("market."+k, got, v)
	}
	last, e := one(c.Binding.Distributor, "lastFundingAt(bytes32)", l.MarketID[2:], "uint64")
	if e != nil {
		return fail()
	}
	compare("market.lastFundingAt", last, strconv.FormatUint(l.LastFundingAt, 10))
	releaseFields := []events.Input{{Name: "unreleased", Type: "uint256"}, {Name: "idleQuote", Type: "uint256"}, {Name: "nextEnd", Type: "uint64"}, {Name: "activeStreams", Type: "uint256"}}
	release, e := read(c.Binding.Distributor, "releaseState(bytes32)", l.MarketID[2:], releaseFields)
	if e != nil {
		return fail()
	}
	remaining := new(big.Int)
	var nextEnd uint64
	active := 0
	for _, stream := range l.Streams {
		if stream.End <= ts {
			continue
		}
		remaining.Add(remaining, new(big.Int).Mul(stream.Rate, new(big.Int).SetUint64(stream.End-ts)))
		remaining.Add(remaining, stream.Remainder)
		if nextEnd == 0 {
			nextEnd = stream.End
		}
		active++
	}
	projected := l.clone()
	projected.checkpoint(ts)
	for k, want := range map[string]string{"unreleased": new(big.Int).Quo(remaining, precision).String(), "idleQuote": new(big.Int).Quo(projected.Idle, precision).String(), "nextEnd": strconv.FormatUint(nextEnd, 10), "activeStreams": strconv.Itoa(active)} {
		got, ok := release[k].(string)
		if !ok {
			return fail()
		}
		compare("release."+k, got, want)
	}
	accounts := make([]string, 0, len(l.Accounts))
	for a := range l.Accounts {
		accounts = append(accounts, a)
	}
	sort.Strings(accounts)
	inventory := sha256.New()
	inventory.Write([]byte("tickergarden-holder-account-inventory-v1\n"))
	for _, account := range accounts {
		view := s.Accounts[account]
		inventory.Write([]byte(account + ":" + view.Balance + ":" + view.EarnedScaled + ":" + view.Index + ":" + view.Claimable + "\n"))
	}
	out.AccountInventoryDigest = "sha256:" + hex.EncodeToString(inventory.Sum(nil))
	total := new(big.Int)
	for _, a := range accounts {
		if ctx.Err() != nil {
			return fail()
		}
		v := s.Accounts[a]
		balance, e := one(l.Token, "balanceOf(address)", "000000000000000000000000"+a[2:], "uint256")
		if e != nil {
			return fail()
		}
		claim, e := one(c.Binding.Distributor, "claimable(bytes32,address)", l.MarketID[2:]+"000000000000000000000000"+a[2:], "uint256")
		if e != nil {
			return fail()
		}
		compare(a+".balance", balance, v.Balance)
		compare(a+".claimable", claim, v.Claimable)
		total.Add(total, l.Accounts[a].Balance)
		out.AccountsChecked++
	}
	totalObserved, e := one(l.Token, "totalSupply()", "", "uint256")
	if e != nil {
		return fail()
	}
	compare("token.totalSupply", totalObserved, total.String())
	// Commit fence: recheck chain, target canonical header and the exact finalized
	// anchor after every state read; a failed fence returns no usable result.
	id, e = rpc.ChainID(ctx)
	if e != nil || id != c.ChainID {
		return fail()
	}
	g, e = rpc.Header(ctx, "0x0")
	if e != nil || g.Hash != c.GenesisHash {
		return fail()
	}
	h, e = rpc.Header(ctx, block.Number)
	if e != nil || h != block {
		return fail()
	}
	anchor, e := rpc.Header(ctx, f.Number)
	if e != nil || anchor != f || ctx.Err() != nil {
		return fail()
	}
	sort.Strings(out.Differences)
	out.FieldsMatched = out.DifferenceCount == 0
	return out, nil
}
