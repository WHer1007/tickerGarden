package chainrpc

import (
	"encoding/json"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
)

func exclusionHeaderRaw(t *testing.T, bloom types.Bloom) (json.RawMessage, string) {
	t.Helper()
	header := types.Header{
		ParentHash:  crypto.Keccak256Hash([]byte("parent")),
		Number:      big.NewInt(17),
		Difficulty:  big.NewInt(1),
		GasLimit:    30_000_000,
		GasUsed:     21_000,
		Time:        123,
		Bloom:       bloom,
		UncleHash:   types.EmptyUncleHash,
		TxHash:      types.EmptyTxsHash,
		ReceiptHash: types.EmptyReceiptsHash,
	}
	hash := header.Hash().Hex()
	b, err := json.Marshal(&header)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(b, &fields); err != nil {
		t.Fatal(err)
	}
	fields["hash"], _ = json.Marshal(hash)
	fields["number"], _ = json.Marshal("0x11")
	b, err = json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	return b, hash
}

func TestVerifyEventExclusionAcceptsAbsentEmitters(t *testing.T) {
	raw, hash := exclusionHeaderRaw(t, types.Bloom{})
	if err := VerifyEventExclusion(raw, hash, []string{
		"0x1111111111111111111111111111111111111111",
		"0x2222222222222222222222222222222222222222",
	}); err != nil {
		t.Fatalf("valid absent emitters rejected: %v", err)
	}
}

func TestVerifyEventExclusionRejectsPositiveBloom(t *testing.T) {
	emitter := common.HexToAddress("0x1111111111111111111111111111111111111111")
	var bloom types.Bloom
	bloom.Add(emitter.Bytes())
	raw, hash := exclusionHeaderRaw(t, bloom)
	if err := VerifyEventExclusion(raw, hash, []string{emitter.Hex()}); err == nil {
		t.Fatal("positive bloom was accepted")
	}
}

func TestVerifyEventExclusionRejectsAnyPositiveAmongEmitters(t *testing.T) {
	positive := common.HexToAddress("0x1111111111111111111111111111111111111111")
	var bloom types.Bloom
	bloom.Add(positive.Bytes())
	raw, hash := exclusionHeaderRaw(t, bloom)
	if err := VerifyEventExclusion(raw, hash, []string{
		"0x2222222222222222222222222222222222222222",
		positive.Hex(),
	}); err == nil {
		t.Fatal("one positive emitter among several was accepted")
	}
}

func TestVerifyEventExclusionRejectsTamperedHeaderOrHash(t *testing.T) {
	raw, hash := exclusionHeaderRaw(t, types.Bloom{})
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	fields["gasUsed"] = json.RawMessage(`"0x5209"`)
	tampered, _ := json.Marshal(fields)
	emitter := []string{"0x1111111111111111111111111111111111111111"}
	if err := VerifyEventExclusion(tampered, hash, emitter); err == nil {
		t.Fatal("tampered header was accepted")
	}
	if err := VerifyEventExclusion(raw, common.HexToHash("0x1").Hex(), emitter); err == nil {
		t.Fatal("wrong hash was accepted")
	}
}

func TestVerifyEventExclusionRejectsMalformedOrEmptyEmitters(t *testing.T) {
	raw, hash := exclusionHeaderRaw(t, types.Bloom{})
	for _, emitters := range [][]string{nil, {}, {""}, {"0x0"}, {"0x111111111111111111111111111111111111111"}, {"0xzz1111111111111111111111111111111111111111"}, {"0x0000000000000000000000000000000000000000"}} {
		if err := VerifyEventExclusion(raw, hash, emitters); err == nil {
			t.Errorf("malformed emitter inventory accepted: %#v", emitters)
		}
	}
}

func TestVerifyEventExclusionRejectsMissingBloomField(t *testing.T) {
	raw, hash := exclusionHeaderRaw(t, types.Bloom{})
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	delete(fields, "logsBloom")
	raw, _ = json.Marshal(fields)
	if err := VerifyEventExclusion(raw, hash, []string{"0x1111111111111111111111111111111111111111"}); err == nil {
		t.Fatal("header with missing bloom field was accepted")
	}
}
