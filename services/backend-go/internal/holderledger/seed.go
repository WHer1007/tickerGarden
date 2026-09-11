package holderledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"tickergarden/backend/internal/analytics"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
)

var ErrSeedAuthentication = errors.New("holder seed authentication unavailable")

type SeedRPC interface {
	ReconcileRPC
	AuthenticatedTransactions(context.Context, uint64, string) (chainrpc.TransactionBlock, error)
	Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error)
}

type SeedConfig struct {
	Scope           CheckpointScope `json:"scope"`
	Factory         string          `json:"factory"`
	FactoryCodeHash string          `json:"factoryCodeHash"`
}

type AuthenticatedSeed struct {
	Block               chainrpc.Header `json:"block"`
	RegistrationTx      string          `json:"registrationTx"`
	Transactions        int             `json:"transactions"`
	Transfers           int             `json:"transfers"`
	Accounts            int             `json:"accounts"`
	EvidenceDigest      string          `json:"evidenceDigest"`
	HistoryVerified     bool            `json:"historyVerified"`
	PublicationEligible bool            `json:"publicationEligible"`
}

// AuthenticatePristineSeed constructs an end-of-deployment-block seed only
// when complete root-verified receipts, the unique constructor mint, the Holder
// registration and hash-pinned state reads all agree. A non-pristine reward
// state, same-block burn, incomplete account inventory or reorg fails closed.
// This authenticates one block boundary; it does not grant publication status.
func AuthenticatePristineSeed(ctx context.Context, rpc SeedRPC, c SeedConfig, block chainrpc.Header) (*Ledger, AuthenticatedSeed, error) {
	return authenticatePristineSeed(ctx, rpc, c, block)
}

func authenticatePristineSeed(ctx context.Context, rpc SeedRPC, c SeedConfig, block chainrpc.Header) (*Ledger, AuthenticatedSeed, error) {
	fail := func() (*Ledger, AuthenticatedSeed, error) { return nil, AuthenticatedSeed{}, ErrSeedAuthentication }
	if rpc == nil || !address.MatchString(c.Factory) || c.Factory == zero || !hash.MatchString(c.FactoryCodeHash) {
		return fail()
	}
	if _, err := scopeKey(c.Scope); err != nil {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	n, err := block.Height()
	if err != nil || n == 0 {
		return fail()
	}
	ts, err := block.Time()
	if err != nil || ts > ^uint64(0)-Duration {
		return fail()
	}
	parentNumber := fmt.Sprintf("0x%x", n-1)
	parent, err := rpc.Header(ctx, parentNumber)
	if err != nil || parent.Hash != block.ParentHash {
		return fail()
	}
	id, err := rpc.ChainID(ctx)
	if err != nil || id != c.Scope.Config.ChainID {
		return fail()
	}
	genesis, err := rpc.Header(ctx, "0x0")
	if err != nil || genesis.Hash != c.Scope.Config.GenesisHash {
		return fail()
	}
	canonical, err := rpc.Header(ctx, block.Number)
	if err != nil || canonical != block {
		return fail()
	}
	finalized, err := rpc.Header(ctx, "finalized")
	if err != nil {
		return fail()
	}
	finalizedHeight, err := finalized.Height()
	if err != nil || finalizedHeight < n {
		return fail()
	}
	priorCode, err := rpc.CodeAt(ctx, c.Scope.Token, parent.Hash)
	if err != nil || len(priorCode) != 0 {
		return fail()
	}
	for _, binding := range []struct{ address, digest string }{
		{c.Scope.Token, c.Scope.Config.TokenCodeHash},
		{c.Scope.Config.Binding.Distributor, c.Scope.Config.DistributorCodeHash},
		{c.Factory, c.FactoryCodeHash},
	} {
		code, codeErr := rpc.CodeAt(ctx, binding.address, block.Hash)
		if codeErr != nil || len(code) == 0 || deployment.Hash(code) != binding.digest {
			return fail()
		}
	}
	txs, err := rpc.AuthenticatedTransactions(ctx, c.Scope.Config.ChainID, block.Hash)
	if err != nil || txs.Header != block || !hash.MatchString(txs.ReceiptRoot) || len(txs.Transactions) > 16384 {
		return fail()
	}
	observation, err := rpc.Observe(ctx, block)
	if err != nil || observation.RootProof == nil || observation.RootProof.BlockHash != block.Hash || observation.RootProof.ReceiptRoot != txs.ReceiptRoot || observation.RootProof.ReceiptCount != len(txs.Transactions) || len(observation.Receipts) != len(txs.Transactions) {
		return fail()
	}
	receiptSet, err := chainrpc.ReceiptSetCommitment(observation.Receipts)
	if err != nil || receiptSet != observation.RootProof.ReceiptSetHash {
		return fail()
	}
	tokenLogs := make([]chainrpc.Log, 0)
	for _, log := range observation.Logs {
		if log.Address == c.Scope.Token {
			tokenLogs = append(tokenLogs, log)
		}
	}
	transfers, err := analytics.DecodeHolderTransfers(c.Scope.Config.ChainID, c.Scope.Token, observation.Receipts, tokenLogs)
	if err != nil || len(transfers) == 0 || len(transfers) > c.Scope.Config.MaxAccounts*4 {
		return fail()
	}
	registrationTx := ""
	registrationIndex := uint64(0)
	registrationCount := 0
	for _, log := range observation.Logs {
		if log.Address != c.Scope.Config.Binding.Distributor {
			continue
		}
		decoded, decodeErr := events.Decode("HolderRewardsDistributorV1", log)
		if decodeErr != nil || decoded.Signature != "HolderStreamMarketRegistered(bytes32,address,address,address)" || decoded.Args["marketId"] != c.Scope.MarketID || decoded.Args["token"] != c.Scope.Token || decoded.Args["quote"] != c.Scope.Config.Quote || decoded.Args["vault"] != c.Scope.Config.Binding.Vault {
			continue
		}
		index, indexErr := chainrpc.Quantity(log.LogIndex)
		if indexErr != nil {
			return fail()
		}
		registrationTx, registrationIndex = log.TransactionHash, index
		registrationCount++
	}
	if registrationCount != 1 || transfers[0].From != zero || transfers[0].Source.TransactionHash != registrationTx || transfers[0].Source.LogIndex >= registrationIndex {
		return fail()
	}
	read := func(target, signature, args string, fields []events.Input) (map[string]any, error) {
		raw, readErr := rpc.CallAt(ctx, target, selector(signature)+args, block.Hash)
		if readErr != nil && signature == "treasuryDistributor()" && strings.Contains(strings.ToLower(readErr.Error()), "execution reverted") {
			raw, readErr = rpc.CallAt(ctx, target, selector("holderRewardsDistributor()")+args, block.Hash)
		}
		if readErr != nil {
			return nil, ErrSeedAuthentication
		}
		return events.DecodeStatic(fields, raw)
	}
	one := func(target, signature, args, typ string) (any, error) {
		values, readErr := read(target, signature, args, []events.Input{{Name: "value", Type: typ}})
		if readErr != nil {
			return nil, readErr
		}
		return values["value"], nil
	}
	identity := []struct {
		signature, typ string
		want           any
	}{
		{"marketId()", "bytes32", c.Scope.MarketID},
		{"treasuryDistributor()", "address", c.Scope.Config.Binding.Distributor},
		{"factory()", "address", c.Factory},
		{"deployedAt()", "uint64", fmt.Sprintf("%d", ts)},
		{"continuousRewardsEnabled()", "bool", true},
	}
	for _, field := range identity {
		value, readErr := one(c.Scope.Token, field.signature, "", field.typ)
		if readErr != nil || value != field.want {
			return fail()
		}
	}
	initialValue, err := one(c.Scope.Token, "initialSupply()", "", "uint256")
	if err != nil {
		return fail()
	}
	initialSupply, ok := initialValue.(string)
	if !ok || transfers[0].Value != initialSupply {
		return fail()
	}
	totalValue, err := one(c.Scope.Token, "totalSupply()", "", "uint256")
	if err != nil {
		return fail()
	}
	totalSupply, ok := totalValue.(string)
	if !ok || totalSupply != initialSupply {
		return fail()
	}
	exclusions, err := seedExclusions(ctx, rpc, c.Scope, block.Hash)
	if err != nil {
		return fail()
	}
	excluded := map[string]bool{}
	for _, account := range exclusions {
		excluded[account] = true
	}
	if !excluded[zero] || !excluded[c.Scope.Token] || !excluded[c.Scope.Config.Binding.Distributor] || !excluded[c.Scope.Config.Binding.Vault] || !excluded[transfers[0].To] {
		return fail()
	}
	rebuildExclusions := make([]string, 0, len(exclusions)-1)
	for _, account := range exclusions {
		if account != zero {
			rebuildExclusions = append(rebuildExclusions, account)
		}
	}
	rebuilt, err := analytics.RebuildHolderBalances(c.Scope.Config.ChainID, c.Scope.Token, transfers[0].To, c.Scope.Config.Binding.Distributor, initialSupply, transfers, rebuildExclusions)
	if err != nil || rebuilt.TotalSupplyRaw != totalSupply {
		return fail()
	}
	accounts := map[string]bool{zero: true}
	for _, account := range exclusions {
		accounts[account] = true
	}
	for _, transfer := range transfers {
		accounts[transfer.From], accounts[transfer.To] = true, true
	}
	if len(accounts) > c.Scope.Config.MaxAccounts {
		return fail()
	}
	balances := make(map[string]string, len(accounts))
	observedSum := new(big.Int)
	for account := range accounts {
		value, readErr := one(c.Scope.Token, "balanceOf(address)", "000000000000000000000000"+account[2:], "uint256")
		balance, valueOK := value.(string)
		amount, amountOK := new(big.Int).SetString(balance, 10)
		if readErr != nil || !valueOK || !amountOK {
			return fail()
		}
		balances[account] = balance
		observedSum.Add(observedSum, amount)
	}
	if observedSum.String() != totalSupply {
		return fail()
	}
	rebuiltBalances := map[string]string{}
	for _, balance := range rebuilt.Balances {
		rebuiltBalances[balance.Account] = balance.BalanceRaw
	}
	for account, balance := range balances {
		want := rebuiltBalances[account]
		if want == "" {
			want = "0"
		}
		if balance != want {
			return fail()
		}
	}
	modeValue, modeErr := one(c.Scope.Config.Binding.Distributor, "rewardMode()", "", "bytes32")
	mode, modeOK := modeValue.(string)
	if modeErr != nil || !modeOK || (mode != deployment.Hash([]byte(deployment.LegacyContinuousHolderMode)) && mode != deployment.Hash([]byte(deployment.BatchedContinuousHolderMode)) && mode != deployment.Hash([]byte(ConfigurableBatchedHolderMode))) {
		return fail()
	}
	ledger, err := New(Registration{Batched: mode == deployment.Hash([]byte(deployment.BatchedContinuousHolderMode)) || mode == deployment.Hash([]byte(ConfigurableBatchedHolderMode)), ConfigurableInterval: mode == deployment.Hash([]byte(ConfigurableBatchedHolderMode)), MarketID: c.Scope.MarketID, Token: c.Scope.Token, TotalSupply: totalSupply, Timestamp: ts, Excluded: exclusions, Balances: balances})
	if err != nil {
		return fail()
	}
	reconciliation, err := ledger.Reconcile(ctx, rpc, c.Scope.Config, block)
	if err != nil || !reconciliation.FieldsMatched || reconciliation.DifferenceCount != 0 {
		return fail()
	}
	for _, want := range []chainrpc.Header{parent, block, finalized} {
		header, headerErr := rpc.Header(ctx, want.Number)
		if headerErr != nil || header != want {
			return fail()
		}
	}
	id, err = rpc.ChainID(ctx)
	if err != nil || id != c.Scope.Config.ChainID {
		return fail()
	}
	genesis, err = rpc.Header(ctx, "0x0")
	if err != nil || genesis.Hash != c.Scope.Config.GenesisHash || ctx.Err() != nil {
		return fail()
	}
	for _, binding := range []struct{ address, digest string }{
		{c.Scope.Token, c.Scope.Config.TokenCodeHash},
		{c.Scope.Config.Binding.Distributor, c.Scope.Config.DistributorCodeHash},
		{c.Factory, c.FactoryCodeHash},
	} {
		code, codeErr := rpc.CodeAt(ctx, binding.address, block.Hash)
		if codeErr != nil || deployment.Hash(code) != binding.digest {
			return fail()
		}
	}
	evidence := struct {
		Config         SeedConfig
		Parent, Block  chainrpc.Header
		Finalized      chainrpc.Header
		RegistrationTx string
		ReceiptSet     string
		ReceiptRoot    string
		Transfers      []analytics.HolderTransfer
		Exclusions     []string
		Balances       map[string]string
	}{c, parent, block, finalized, registrationTx, receiptSet, txs.ReceiptRoot, transfers, exclusions, balances}
	raw, err := json.Marshal(evidence)
	if err != nil {
		return fail()
	}
	digest := sha256.Sum256(raw)
	return ledger, AuthenticatedSeed{Block: block, RegistrationTx: registrationTx, Transactions: len(txs.Transactions), Transfers: len(transfers), Accounts: len(accounts), EvidenceDigest: "sha256:" + hex.EncodeToString(digest[:])}, nil
}

func seedExclusions(ctx context.Context, rpc ReconcileRPC, scope CheckpointScope, blockHash string) ([]string, error) {
	raw, err := rpc.CallAt(ctx, scope.Config.Binding.Distributor, selector("feeSharingExcludedAccounts(bytes32)")+scope.MarketID[2:], blockHash)
	if err != nil || len(raw) < 64 || len(raw) > 64+9*32 || new(big.Int).SetBytes(raw[:32]).Cmp(big.NewInt(32)) != 0 {
		return nil, ErrSeedAuthentication
	}
	count := new(big.Int).SetBytes(raw[32:64])
	if !count.IsInt64() || count.Sign() < 0 || count.Int64() > 9 || len(raw) != 64+int(count.Int64())*32 {
		return nil, ErrSeedAuthentication
	}
	result := make([]string, 0, count.Int64())
	seen := map[string]bool{}
	for i := 0; i < int(count.Int64()); i++ {
		account, decodeErr := addr(hex.EncodeToString(raw[64+i*32 : 96+i*32]))
		if decodeErr != nil || seen[account] {
			return nil, ErrSeedAuthentication
		}
		seen[account] = true
		result = append(result, account)
	}
	return result, nil
}
