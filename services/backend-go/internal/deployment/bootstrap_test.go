package deployment

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/trie"
	"tickergarden/backend/internal/chainrpc"
)

type bootstrapObserver struct {
	id      uint64
	headers map[string]chainrpc.Header
	codes   map[string]map[string][]byte
	err     error
}

func (o *bootstrapObserver) ChainID(context.Context) (uint64, error) { return o.id, o.err }
func (o *bootstrapObserver) Header(_ context.Context, n string) (chainrpc.Header, error) {
	h, ok := o.headers[n]
	if !ok {
		return chainrpc.Header{}, fmt.Errorf("missing header %s", n)
	}
	return h, o.err
}
func (o *bootstrapObserver) CodeAt(_ context.Context, a, h string) ([]byte, error) {
	return o.codes[a][h], o.err
}

func bootstrapHeader(t *testing.T, number uint64, parent string, logAddress string) (chainrpc.Header, []byte) {
	t.Helper()
	tx := common.HexToHash(fmt.Sprintf("0x%x", number+100))
	logs := []*types.Log{}
	if logAddress != "" {
		logs = append(logs, &types.Log{Address: common.HexToAddress(logAddress), Topics: []common.Hash{common.HexToHash("0x1")}, BlockNumber: number, TxHash: tx, Index: 0})
	}
	r := types.Receipt{Type: 2, Status: 1, CumulativeGasUsed: 21000, GasUsed: 21000, TxHash: tx, TransactionIndex: 0, Logs: logs, BlockNumber: new(big.Int).SetUint64(number)}
	r.Bloom = types.CreateBloom(&r)
	enc, err := rlp.EncodeToBytes([]any{r.Status, r.CumulativeGasUsed, r.Bloom, r.Logs})
	if err != nil {
		t.Fatal(err)
	}
	enc = append([]byte{2}, enc...)
	root := types.DeriveSha(encodedBootstrapReceipts{enc}, trie.NewStackTrie(nil))
	h := types.Header{Number: new(big.Int).SetUint64(number), ParentHash: common.HexToHash(parent), Difficulty: new(big.Int), GasLimit: 30_000_000, GasUsed: 21000, Time: number + 100, UncleHash: types.EmptyUncleHash, TxHash: types.EmptyTxsHash, ReceiptHash: root, Bloom: r.Bloom}
	hash := h.Hash().Hex()
	r.BlockHash = h.Hash()
	for _, l := range logs {
		l.BlockHash = h.Hash()
	}
	rawH, _ := json.Marshal(&h)
	var obj map[string]any
	_ = json.Unmarshal(rawH, &obj)
	obj["hash"], obj["transactions"] = hash, []string{tx.Hex()}
	rawH, _ = json.Marshal(obj)
	rawR, _ := json.Marshal(&r)
	return chainrpc.Header{Number: fmt.Sprintf("0x%x", number), Hash: hash, ParentHash: parent, Timestamp: fmt.Sprintf("0x%x", number+100)}, rawBundle(t, rawH, []json.RawMessage{rawR})
}

type encodedBootstrapReceipts [][]byte

func (r encodedBootstrapReceipts) Len() int                           { return len(r) }
func (r encodedBootstrapReceipts) EncodeIndex(i int, w *bytes.Buffer) { w.Write(r[i]) }

func rawBundle(t *testing.T, h json.RawMessage, r []json.RawMessage) []byte {
	t.Helper()
	b, e := json.Marshal([]chainrpc.ReceiptRootBundle{{Header: h, Receipts: r}})
	if e != nil {
		t.Fatal(e)
	}
	return b
}

func headerHash(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var h struct {
		Hash string `json:"hash"`
	}
	if err := json.Unmarshal(raw, &h); err != nil {
		t.Fatal(err)
	}
	return h.Hash
}

func bootstrapFixture(t *testing.T, protocolLog string) (Manifest, *bootstrapObserver, chainrpc.Header, []byte) {
	t.Helper()
	gen := "0x" + fmt.Sprintf("%064x", 1)
	parent, _ := bootstrapHeader(t, 9, gen, "")
	h10, b10 := bootstrapHeader(t, 10, parent.Hash, protocolLog)
	h11, b11 := bootstrapHeader(t, 11, h10.Hash, "")
	start := chainrpc.Header{Number: "0xc", Hash: fmt.Sprintf("0x%064x", 12), ParentHash: h11.Hash}
	pool, proto := "0x0000000000000000000000000000000000000011", "0x0000000000000000000000000000000000000022"
	poolCode, protoCode := []byte("pool"), []byte("protocol")
	m := Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 4663, GenesisHash: gen, Contracts: []Contract{{Module: "UniswapV4PoolManager", Address: pool, RuntimeCodeHash: Hash(poolCode)}, {Module: "TickerGardenFactoryV1", Address: proto, RuntimeCodeHash: Hash(protoCode)}}}
	raw := append(append([]byte{}, b10...), b11...)
	var bs []chainrpc.ReceiptRootBundle
	_ = json.Unmarshal(b10, &bs)
	var bs2 []chainrpc.ReceiptRootBundle
	_ = json.Unmarshal(b11, &bs2)
	bs = append(bs, bs2...)
	raw, _ = json.Marshal(bs)
	m.Bootstrap = &Bootstrap{Version: 1, DeploymentStartBlock: 10, DeploymentStartHash: h10.Hash, BusinessStartBlock: 12, BusinessStartHash: start.Hash, EvidenceHash: Hash(raw)}
	o := &bootstrapObserver{id: 4663, headers: map[string]chainrpc.Header{"0x0": {Hash: gen}, "0x9": parent, "0xc": start}, codes: map[string]map[string][]byte{pool: {parent.Hash: poolCode, start.Hash: poolCode}, proto: {parent.Hash: nil, start.Hash: protoCode}}}
	return m, o, start, raw
}

func TestVerifyBootstrapRejectsTamperingAndInvalidAnchors(t *testing.T) {
	validM, validO, start, raw := bootstrapFixture(t, "")
	var validBundles []chainrpc.ReceiptRootBundle
	if err := json.Unmarshal(raw, &validBundles); err != nil {
		t.Fatal(err)
	}
	for _, b := range validBundles {
		if _, err := chainrpc.VerifyReceiptRootBundle(b.Header, b.Receipts, headerHash(t, b.Header)); err != nil {
			t.Fatalf("fixture receipt proof: %v", err)
		}
	}
	if err := VerifyBootstrap(context.Background(), validO, validM, start, raw); err != nil {
		t.Fatalf("valid bootstrap: %v", err)
	}
	poolLogM, poolLogO, poolLogStart, poolLogRaw := bootstrapFixture(t, validM.Contracts[0].Address)
	if err := VerifyBootstrap(context.Background(), poolLogO, poolLogM, poolLogStart, poolLogRaw); err != nil {
		t.Fatalf("external PoolManager log was rejected: %v", err)
	}
	cases := map[string]func(*Manifest, *bootstrapObserver, chainrpc.Header, []byte){
		"protocol log": func(m *Manifest, o *bootstrapObserver, s chainrpc.Header, r []byte) { _ = m; _ = o; _ = s; _ = r },
		"receipt tamper": func(m *Manifest, o *bootstrapObserver, s chainrpc.Header, r []byte) {
			r[len(r)-2] ^= 1
			m.Bootstrap.EvidenceHash = Hash(r)
		},
		"missing block": func(m *Manifest, o *bootstrapObserver, s chainrpc.Header, r []byte) {
			var bs []chainrpc.ReceiptRootBundle
			_ = json.Unmarshal(r, &bs)
			bs = bs[:1]
			r2, _ := json.Marshal(bs)
			m.Bootstrap.EvidenceHash = Hash(r2)
			// Mutations to raw are applied by the case-specific return below.
			_ = r2
		},
		"preexisting protocol": func(m *Manifest, o *bootstrapObserver, s chainrpc.Header, r []byte) {
			o.codes[m.Contracts[1].Address][o.headers["0x9"].Hash] = []byte("already")
		},
		"pool code changed": func(m *Manifest, o *bootstrapObserver, s chainrpc.Header, r []byte) {
			o.codes[m.Contracts[0].Address][o.headers["0x9"].Hash] = []byte("changed")
		},
		"wrong chain": func(m *Manifest, o *bootstrapObserver, s chainrpc.Header, r []byte) { o.id = 1 },
		"wrong genesis": func(m *Manifest, o *bootstrapObserver, s chainrpc.Header, r []byte) {
			m.GenesisHash = fmt.Sprintf("0x%064x", 99)
		},
		"oversize": func(m *Manifest, o *bootstrapObserver, s chainrpc.Header, r []byte) {
			m.Bootstrap.EvidenceHash = Hash(append(r, make([]byte, MaxBootstrapBytes)...))
		},
		"canonical fence": func(m *Manifest, o *bootstrapObserver, s chainrpc.Header, r []byte) {
			h := o.headers[s.Number]
			h.Hash = fmt.Sprintf("0x%064x", 99)
			o.headers[s.Number] = h
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			m, o, s, r := bootstrapFixture(t, "")
			mutate(&m, o, s, r)
			if name == "protocol log" {
				m, o, s, r = bootstrapFixture(t, "0x0000000000000000000000000000000000000022")
			}
			if name == "missing block" {
				var bs []chainrpc.ReceiptRootBundle
				_ = json.Unmarshal(r, &bs)
				r, _ = json.Marshal(bs[:1])
				m.Bootstrap.EvidenceHash = Hash(r)
			}
			if VerifyBootstrap(context.Background(), o, m, s, r) == nil {
				t.Fatal("accepted invalid bootstrap")
			}
		})
	}
}

func TestParseBootstrapBoundaries(t *testing.T) {
	base := Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 4663, GenesisHash: fmt.Sprintf("0x%064x", 1), Contracts: []Contract{{Module: "UniswapV4PoolManager", Address: "0x0000000000000000000000000000000000000011", RuntimeCodeHash: fmt.Sprintf("0x%064x", 2)}}}
	encode := func(m Manifest) []byte {
		b, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	if _, err := Parse(encode(base)); err != nil {
		t.Fatalf("legacy manifest rejected: %v", err)
	}
	valid := &Bootstrap{Version: 1, DeploymentStartBlock: 10, DeploymentStartHash: fmt.Sprintf("0x%064x", 3), BusinessStartBlock: 11, BusinessStartHash: fmt.Sprintf("0x%064x", 4), EvidenceHash: fmt.Sprintf("0x%064x", 5)}
	base.Bootstrap = valid
	if _, err := Parse(encode(base)); err != nil {
		t.Fatalf("valid bootstrap rejected: %v", err)
	}
	cases := map[string]func(*Bootstrap){
		"version":         func(b *Bootstrap) { b.Version = 2 },
		"interval zero":   func(b *Bootstrap) { b.BusinessStartBlock = b.DeploymentStartBlock },
		"interval 4097":   func(b *Bootstrap) { b.BusinessStartBlock = b.DeploymentStartBlock + 4097 },
		"deployment hash": func(b *Bootstrap) { b.DeploymentStartHash = "0x1234" },
		"business hash":   func(b *Bootstrap) { b.BusinessStartHash = "0x1234" },
		"evidence hash":   func(b *Bootstrap) { b.EvidenceHash = "0x1234" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			m := base
			b := *valid
			mutate(&b)
			m.Bootstrap = &b
			if _, err := Parse(encode(m)); err == nil {
				t.Fatal("accepted invalid bootstrap boundary")
			}
		})
	}
}

func TestBootstrapHeaderExclusion(t *testing.T) {
	for _, event := range []string{"", "0x0000000000000000000000000000000000000011", "0x0000000000000000000000000000000000000022"} {
		t.Run(event, func(t *testing.T) {
			m, o, start, raw := bootstrapFixture(t, event)
			var bundles []chainrpc.ReceiptRootBundle
			if err := json.Unmarshal(raw, &bundles); err != nil {
				t.Fatal(err)
			}
			for i := range bundles {
				bundles[i].Receipts = nil
			}
			raw, _ = json.Marshal(bundles)
			m.Bootstrap.EvidenceHash = Hash(raw)
			err := VerifyBootstrap(context.Background(), o, m, start, raw)
			if (err != nil) != (event == m.Contracts[1].Address) {
				t.Fatalf("unexpected exclusion result: %v", err)
			}
			// A committed corpus alone cannot authorize changing its header bloom.
			var header map[string]any
			_ = json.Unmarshal(bundles[0].Header, &header)
			header["logsBloom"] = "0x" + strings.Repeat("00", 256)
			header["gasLimit"] = "0x1"
			bundles[0].Header, _ = json.Marshal(header)
			raw, _ = json.Marshal(bundles)
			m.Bootstrap.EvidenceHash = Hash(raw)
			if VerifyBootstrap(context.Background(), o, m, start, raw) == nil {
				t.Fatal("accepted tampered header")
			}
		})
	}
}
