package analytics

import (
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestConversionManifestCommitment(t *testing.T) {
	addr := func(c string) string { return "0x" + strings.Repeat(c, 40) }
	hash := "0x" + strings.Repeat("a", 64)
	m := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 4663, GenesisHash: hash, Contracts: []deployment.Contract{{Module: "ProtocolFeeVault", Address: addr("1"), RuntimeCodeHash: hash}, {Module: "UniswapV4PoolManager", Address: addr("2"), RuntimeCodeHash: hash}}}
	want, vault, manager, err := conversionManifest(m)
	if err != nil || vault != addr("1") || manager != addr("2") {
		t.Fatal(err)
	}
	m.Contracts[0], m.Contracts[1] = m.Contracts[1], m.Contracts[0]
	got, _, _, err := conversionManifest(m)
	if err != nil || got != want || m.Contracts[0].Address != addr("2") {
		t.Fatal("sorting changed identity or mutated caller")
	}
	m.Contracts = append(m.Contracts, deployment.Contract{Module: "ProtocolFeeVault", Address: addr("3"), RuntimeCodeHash: hash})
	if _, _, _, err = conversionManifest(m); err == nil {
		t.Fatal("ambiguous vault accepted")
	}
	m.Contracts = m.Contracts[:1]
	if _, _, _, err = conversionManifest(m); err == nil {
		t.Fatal("missing vault accepted")
	}
}
