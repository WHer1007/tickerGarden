package deployment

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

func configObservationSetup(t *testing.T) (*bindingFixture, chainrpc.Header, string, string) {
	t.Helper()
	f := newBindingFixture()
	b := chainrpc.Header{Number: "0x1", Hash: blockHash}
	id := "0x" + strings.Repeat("1", 64)
	roots := map[string]string{}
	for _, c := range f.manifest.Contracts {
		roots[c.Module] = c.Address
	}
	data := make([]byte, 0, len(baselineConfigFields)*32)
	for range baselineConfigFields {
		data = append(data, bytesWord("1")...)
	}
	f.calls[roots["TickerGardenBaselineRegistry"]+Hash([]byte("baseline(bytes32)"))[:10]+id[2:]] = data
	return f, b, id, roots["TickerGardenBaselineRegistry"]
}

func TestObserveConfigBlockBaselineDeduplicatesAndChecksStatus(t *testing.T) {
	f, b, id, _ := configObservationSetup(t)
	batch, err := ObserveConfigBlock(context.Background(), f, f.manifest, b, []ConfigTarget{{Kind: "baseline", ID: id}, {Kind: "baseline", ID: id}})
	if err != nil {
		t.Fatal(err)
	}
	if batch.Expected != 1 || len(batch.Observations) != 1 || batch.Observations[0].Kind != "baseline" {
		t.Fatalf("unexpected batch: %+v", batch)
	}
	if batch.BlockHash != blockHash {
		t.Fatal("source hash missing")
	}
	f, b, id, _ = configObservationSetup(t)
	key := ""
	for _, c := range f.manifest.Contracts {
		if c.Module == "TickerGardenBaselineRegistry" {
			key = c.Address + Hash([]byte("baseline(bytes32)"))[:10] + id[2:]
		}
	}
	f.calls[key][9*32+31] = 0
	if _, err := ObserveConfigBlock(context.Background(), f, f.manifest, b, []ConfigTarget{{Kind: "baseline", ID: id}}); err == nil {
		t.Fatal("accepted invalid status")
	}
}

func TestObserveConfigBlockRejectsDirtyABIAndChangedSource(t *testing.T) {
	f, b, id, root := configObservationSetup(t)
	key := root + Hash([]byte("baseline(bytes32)"))[:10] + id[2:]
	f.calls[key][9*32] = 1
	if _, err := ObserveConfigBlock(context.Background(), f, f.manifest, b, []ConfigTarget{{Kind: "baseline", ID: id}}); err == nil {
		t.Fatal("accepted ABI padding")
	}
	f, b, id, _ = configObservationSetup(t)
	f.reorg = true
	if _, err := ObserveConfigBlock(context.Background(), f, f.manifest, b, []ConfigTarget{{Kind: "baseline", ID: id}}); err == nil {
		t.Fatal("accepted changed source block")
	}
}

func configQuoteTemplateSetup(t *testing.T) (*bindingFixture, chainrpc.Header, string, func(string, string, []byte)) {
	f, b, id, _ := configObservationSetup(t)
	roots := map[string]string{}
	for _, c := range f.manifest.Contracts {
		roots[c.Module] = c.Address
	}
	put := func(module, sig string, raw []byte) { f.calls[roots[module]+Hash([]byte(sig))[:10]+id[2:]] = raw }
	quote := []byte{}
	for _, word := range []string{id, "0", "12", "100", "200", id, "1"} {
		quote = append(quote, bytesWord(word)...)
	}
	put("ApprovedQuoteRegistry", "quoteConfig(bytes32)", quote)
	put("ApprovedQuoteRegistry", "stockQuoteBinding(bytes32)", make([]byte, 128))
	put("ApprovedQuoteRegistry", "quoteRuntimeCodeHash(bytes32)", make([]byte, 32))
	put("ApprovedQuoteRegistry", "quoteIdentityCurrent(bytes32)", bytesWord("0"))
	template := []byte{}
	for i := 0; i < 5; i++ {
		template = append(template, addrWord(roots["TickerGardenFactoryV1"])...)
		template = append(template, bytesWord(Hash([]byte{0}))...)
	}
	template = append(template, bytesWord(id)...)
	template = append(template, bytesWord(Hash([]byte("V1-EXEC-11")))...)
	encoded := append(bytesWord(Hash([]byte("TICKERGARDEN_V1_LAUNCH_TEMPLATE"))), bytesWord("2")...)
	encoded = append(encoded, template...)
	put("LaunchTemplateRegistry", "launchTemplateHash(bytes32)", bytesWord(Hash(encoded)))
	put("LaunchTemplateRegistry", "launchTemplate(bytes32)", append(template, bytesWord("3")...))
	return f, b, id, put
}

func TestConfigQuoteAndTemplateEvidence(t *testing.T) {
	f, b, id, put := configQuoteTemplateSetup(t)
	targets := []ConfigTarget{{Kind: "quote", ID: id}, {Kind: "template", ID: id}}
	batch, e := ObserveConfigBlock(context.Background(), f, f.manifest, b, targets)
	if e != nil {
		t.Fatal(e)
	}
	if len(batch.Observations) != 2 || batch.Observations[0].Value["identityCurrent"] != false || batch.Observations[1].Value["componentCodeIdentityCurrent"] != true || batch.Observations[1].Value["status"] != "3" {
		t.Fatal(batch)
	}
	// A bad later record discards the already completed Quote observation.
	put("LaunchTemplateRegistry", "launchTemplateHash(bytes32)", bytesWord(id))
	batch, e = ObserveConfigBlock(context.Background(), f, f.manifest, b, targets)
	if e == nil || len(batch.Observations) != 0 {
		t.Fatal("partial batch or forged template hash accepted")
	}
}

func TestConfigTargetsFailBeforeRPC(t *testing.T) {
	for _, targets := range [][]ConfigTarget{{{Kind: "asset", ID: wordHex("1")}}, {{Kind: "quote", ID: zero32}}, {{Kind: "template", ID: "bad"}}} {
		f, b, _, _ := configObservationSetup(t)
		if batch, e := ObserveConfigBlock(context.Background(), f, f.manifest, b, targets); e == nil || len(batch.Observations) != 0 || f.reads != 0 {
			t.Fatal("invalid target consumed RPC or returned data")
		}
	}
	targets := make([]ConfigTarget, MaxConfigReads+1)
	for i := range targets {
		targets[i] = ConfigTarget{Kind: "baseline", ID: fmt.Sprintf("0x%064x", i+1)}
	}
	f, b, _, _ := configObservationSetup(t)
	if _, e := ObserveConfigBlock(context.Background(), f, f.manifest, b, targets); e == nil || f.reads != 0 {
		t.Fatal("unbounded config reads")
	}
}
