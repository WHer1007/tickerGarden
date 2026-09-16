package holderledger

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/trie"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

const (
	seedFactory = "0x0000000000000000000000000000000000000040"
	seedDead    = "0x000000000000000000000000000000000000dead"
	seedPool    = "0x0000000000000000000000000000000000000050"
	seedLocker  = "0x0000000000000000000000000000000000000060"
	seedHook    = "0x0000000000000000000000000000000000000070"
)

type seedRPCFixture struct {
	parent, block chainrpc.Header
	txs           chainrpc.TransactionBlock
	observation   chainrpc.Observation
	responses     map[string][]byte
	reorg         bool
	badParentCode bool
}

func (f *seedRPCFixture) ChainID(context.Context) (uint64, error) { return 1, nil }
func (f *seedRPCFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	if tag == "0x0" || tag == f.parent.Number {
		return f.parent, nil
	}
	if tag == "finalized" {
		return f.block, nil
	}
	if tag == f.block.Number {
		h := f.block
		if f.reorg {
			h.Hash = f.parent.Hash
		}
		return h, nil
	}
	return chainrpc.Header{}, ErrInput
}
func (f *seedRPCFixture) CodeAt(_ context.Context, account, blockHash string) ([]byte, error) {
	if blockHash == f.parent.Hash && account == token {
		if f.badParentCode {
			return []byte{1}, nil
		}
		return []byte{}, nil
	}
	if blockHash != f.block.Hash {
		return nil, ErrInput
	}
	return []byte{1}, nil
}
func (f *seedRPCFixture) CallAt(_ context.Context, account, data, blockHash string) ([]byte, error) {
	if blockHash != f.block.Hash {
		return nil, ErrInput
	}
	value, ok := f.responses[account+data]
	if !ok {
		return nil, fmt.Errorf("missing fixture %s", data)
	}
	return value, nil
}
func (f *seedRPCFixture) AuthenticatedTransactions(context.Context, uint64, string) (chainrpc.TransactionBlock, error) {
	return f.txs, nil
}
func (f *seedRPCFixture) Observe(context.Context, chainrpc.Header) (chainrpc.Observation, error) {
	return f.observation, nil
}

func seedLog(address, tx, blockNumber, blockHash, index string, topics []string, data string) chainrpc.Log {
	return chainrpc.Log{Address: address, Topics: topics, Data: data, BlockNumber: blockNumber, BlockHash: blockHash, TransactionHash: tx, TransactionIndex: "0x0", LogIndex: index}
}

func attachSeedRawRoots(t *testing.T, fixture *seedRPCFixture) {
	t.Helper()
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	signer := types.LatestSignerForChainID(big.NewInt(1))
	to := common.HexToAddress(seedFactory)
	tx, err := types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: big.NewInt(1), GasTipCap: big.NewInt(1), GasFeeCap: big.NewInt(2), Gas: 500000, To: &to}), signer, key)
	if err != nil {
		t.Fatal(err)
	}
	typedLogs := make([]*types.Log, len(fixture.observation.Logs))
	for i, log := range fixture.observation.Logs {
		data, decodeErr := hex.DecodeString(log.Data[2:])
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		topics := make([]common.Hash, len(log.Topics))
		for j, topic := range log.Topics {
			topics[j] = common.HexToHash(topic)
		}
		typedLogs[i] = &types.Log{Address: common.HexToAddress(log.Address), Topics: topics, Data: data, BlockNumber: 1, TxHash: tx.Hash(), TxIndex: 0, Index: uint(i)}
	}
	receipt := types.Receipt{Type: tx.Type(), Status: 1, CumulativeGasUsed: 21000, GasUsed: 21000, TxHash: tx.Hash(), BlockNumber: big.NewInt(1), TransactionIndex: 0, Logs: typedLogs}
	receipt.Bloom = types.CreateBloom(&receipt)
	receiptEncoded, err := receipt.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	header := types.Header{Difficulty: big.NewInt(0), ParentHash: common.HexToHash(fixture.parent.Hash), Number: big.NewInt(1), GasLimit: 30000000, GasUsed: 21000, Time: 100, TxHash: types.DeriveSha(types.Transactions{tx}, trie.NewStackTrie(nil)), ReceiptHash: types.DeriveSha(encodedReceipts{receiptEncoded}, trie.NewStackTrie(nil)), Bloom: receipt.Bloom, UncleHash: types.EmptyUncleHash}
	receipt.BlockHash = header.Hash()
	for _, log := range receipt.Logs {
		log.BlockHash = header.Hash()
	}
	headerJSON, _ := json.Marshal(&header)
	transactionJSON, _ := tx.MarshalJSON()
	var blockJSON, receiptHeader map[string]any
	var transaction map[string]any
	json.Unmarshal(headerJSON, &blockJSON)
	json.Unmarshal(headerJSON, &receiptHeader)
	json.Unmarshal(transactionJSON, &transaction)
	from, err := types.Sender(signer, tx)
	if err != nil {
		t.Fatal(err)
	}
	blockHash := header.Hash().Hex()
	transaction["hash"] = tx.Hash().Hex()
	transaction["from"] = strings.ToLower(from.Hex())
	transaction["blockHash"] = blockHash
	transaction["blockNumber"] = "0x1"
	transaction["transactionIndex"] = "0x0"
	blockJSON["hash"] = blockHash
	blockJSON["transactions"] = []any{transaction}
	receiptHeader["hash"] = blockHash
	receiptHeader["transactions"] = []string{tx.Hash().Hex()}
	rawBlock, _ := json.Marshal(blockJSON)
	rawReceiptHeader, _ := json.Marshal(receiptHeader)
	rawReceipt, _ := json.Marshal(&receipt)
	transactions, err := chainrpc.VerifyTransactionBlock(rawBlock, 1, blockHash)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := chainrpc.VerifyReceiptRootBundle(rawReceiptHeader, []json.RawMessage{rawReceipt}, blockHash)
	if err != nil {
		t.Fatal(err)
	}
	var minimal chainrpc.Receipt
	if json.Unmarshal(rawReceipt, &minimal) != nil {
		t.Fatal("receipt JSON")
	}
	fixture.block = transactions.Header
	fixture.txs = transactions
	fixture.observation = chainrpc.Observation{Logs: append([]chainrpc.Log(nil), minimal.Logs...), Receipts: []chainrpc.Receipt{minimal}, RootProof: &proof}
}

func seedCase(t *testing.T) (*seedRPCFixture, SeedConfig) {
	t.Helper()
	parent := chainrpc.Header{Number: "0x0", Timestamp: "0x0", Hash: "0x" + strings.Repeat("a", 64), ParentHash: "0x" + strings.Repeat("0", 64)}
	block := chainrpc.Header{Number: "0x1", Timestamp: "0x64", Hash: "0x" + strings.Repeat("b", 64), ParentHash: parent.Hash}
	tx := "0x" + strings.Repeat("c", 64)
	transferTopic := deployment.Hash([]byte("Transfer(address,address,uint256)"))
	registrationTopic := deployment.Hash([]byte("HolderStreamMarketRegistered(bytes32,address,address,address)"))
	mint := seedLog(token, tx, block.Number, block.Hash, "0x0", []string{transferTopic, "0x" + traceAddress(zero), "0x" + traceAddress(a)}, "0x"+traceWord("64"))
	registered := seedLog(distributor, tx, block.Number, block.Hash, "0x1", []string{registrationTopic, market, "0x" + traceAddress(token)}, "0x"+traceAddress(zero)+traceAddress(vault))
	transfer := seedLog(token, tx, block.Number, block.Hash, "0x2", []string{transferTopic, "0x" + traceAddress(a), "0x" + traceAddress(b)}, "0x"+traceWord("28"))
	receipt := chainrpc.Receipt{TransactionHash: tx, TransactionIndex: "0x0", BlockHash: block.Hash, BlockNumber: block.Number, Status: "0x1", Logs: []chainrpc.Log{mint, registered, transfer}}
	root := "0x" + strings.Repeat("d", 64)
	commitment, err := chainrpc.ReceiptSetCommitment([]chainrpc.Receipt{receipt})
	if err != nil {
		t.Fatal(err)
	}
	f := &seedRPCFixture{
		parent:      parent,
		block:       block,
		txs:         chainrpc.TransactionBlock{Header: block, ReceiptRoot: root, Transactions: []chainrpc.AuthenticatedTransaction{{Hash: tx, From: b, To: seedFactory, Input: "0x", Value: "0x0", Type: 2}}},
		observation: chainrpc.Observation{Logs: []chainrpc.Log{mint, registered, transfer}, Receipts: []chainrpc.Receipt{receipt}, RootProof: &chainrpc.ReceiptRootVerification{BlockHash: block.Hash, ReceiptRoot: root, ReceiptCount: 1, ReceiptSetHash: commitment}},
		responses:   map[string][]byte{},
	}
	config := SeedConfig{Scope: CheckpointScope{MarketID: market, Token: token, Config: ReconcileConfig{ChainID: 1, GenesisHash: parent.Hash, Binding: Binding{Distributor: distributor, Vault: vault}, Quote: zero, TokenCodeHash: deployment.Hash([]byte{1}), DistributorCodeHash: deployment.Hash([]byte{1}), MaxAccounts: 10}}, Factory: seedFactory, FactoryCodeHash: deployment.Hash([]byte{1})}
	set := func(account, signature, args string, words ...string) {
		f.responses[account+selector(signature)+args] = abiWords(words...)
	}
	set(token, "marketId()", "", market)
	set(token, "treasuryDistributor()", "", distributor)
	set(token, "factory()", "", seedFactory)
	set(token, "deployedAt()", "", "100")
	set(token, "continuousRewardsEnabled()", "", "1")
	set(token, "initialSupply()", "", "100")
	set(token, "totalSupply()", "", "100")
	set(distributor, "rewardMode()", "", deployment.Hash([]byte("TICKERGARDEN_HOLDER_STREAM_24H_V1")))
	set(distributor, "STREAM_DURATION()", "", "86400")
	exclusions := []string{zero, seedDead, token, a, seedPool, seedLocker, distributor, vault, seedHook}
	words := []string{"32", "9"}
	words = append(words, exclusions...)
	set(distributor, "feeSharingExcludedAccounts(bytes32)", market[2:], words...)
	set(distributor, "marketState(bytes32)", market[2:], token, zero, vault, "100", "0", "0", "40", "0", "0", "0", "0", "0", "0")
	set(distributor, "lastFundingAt(bytes32)", market[2:], "0")
	set(distributor, "releaseState(bytes32)", market[2:], "0", "0", "0", "0")
	balances := map[string]string{zero: "0", seedDead: "0", token: "0", a: "60", b: "40", seedPool: "0", seedLocker: "0", distributor: "0", vault: "0", seedHook: "0"}
	for account, balance := range balances {
		args := "000000000000000000000000" + account[2:]
		set(token, "balanceOf(address)", args, balance)
		set(distributor, "claimable(bytes32,address)", market[2:]+args, "0")
	}
	attachSeedRawRoots(t, f)
	return f, config
}

func TestAuthenticatePristineSeed(t *testing.T) {
	f, config := seedCase(t)
	ledger, report, err := AuthenticatePristineSeed(t.Context(), f, config, f.block)
	if err != nil || ledger == nil || report.Transactions != 1 || report.Transfers != 2 || report.Accounts != 10 || report.RegistrationTx == "" || !replayDigestPattern.MatchString(report.EvidenceDigest) {
		t.Fatalf("seed=%+v ledger=%+v err=%v", report, ledger, err)
	}
	if ledger.Supply.String() != "40" || report.HistoryVerified || report.PublicationEligible {
		t.Fatal("invalid authenticated seed flags or supply")
	}
}

func TestAuthenticatePristineSeedEvidence(t *testing.T) {
	f, config := seedCase(t)
	ledger, report, evidence, err := AuthenticatePristineSeedWithEvidence(t.Context(), f, config, f.block)
	if err != nil || ledger == nil || report.RegistrationTx == "" || evidence.Version != 1 {
		t.Fatalf("raw seed evidence rejected: %+v %+v %v", report, evidence, err)
	}
	f.txs.RawBlock = nil
	if ledger, report, evidence, err = AuthenticatePristineSeedWithEvidence(t.Context(), f, config, f.block); !errors.Is(err, ErrSeedAuthentication) || ledger != nil || report != (AuthenticatedSeed{}) || evidence.Version != 0 {
		t.Fatalf("summary-only seed produced durable evidence: %+v %+v %v", report, evidence, err)
	}
}

func TestAuthenticatePristineSeedRejectsUnsafeEvidence(t *testing.T) {
	for _, mode := range []string{"parent-code", "wrong-factory", "burn", "funded", "missing-registration", "registration-before-mint", "reorg", "receipt-root"} {
		t.Run(mode, func(t *testing.T) {
			f, config := seedCase(t)
			switch mode {
			case "parent-code":
				f.badParentCode = true
			case "wrong-factory":
				f.responses[token+selector("factory()")] = abiWords(vault)
			case "burn":
				f.responses[token+selector("totalSupply()")] = abiWords("99")
			case "funded":
				f.responses[distributor+selector("marketState(bytes32)")+market[2:]] = abiWords(token, zero, vault, "100", "0", "1", "40", "0", "0", "1", "0", "1", "0")
			case "missing-registration":
				f.observation.Logs = append([]chainrpc.Log{f.observation.Logs[0]}, f.observation.Logs[2:]...)
			case "registration-before-mint":
				f.observation.Logs[1].LogIndex = "0x0"
			case "reorg":
				f.reorg = true
			case "receipt-root":
				f.observation.RootProof.ReceiptRoot = f.parent.Hash
			}
			if ledger, report, err := AuthenticatePristineSeed(t.Context(), f, config, f.block); !errors.Is(err, ErrSeedAuthentication) || ledger != nil || report != (AuthenticatedSeed{}) {
				t.Fatalf("accepted %s: ledger=%+v report=%+v err=%v", mode, ledger, report, err)
			}
		})
	}
}
