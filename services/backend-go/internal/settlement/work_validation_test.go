package settlement

import (
	"crypto/ed25519"
	"encoding/base64"
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
)

func validWorkSpec(t *testing.T) WorkSpec {
	t.Helper()
	key1, _, _ := ed25519.GenerateKey(nil)
	key2, _, _ := ed25519.GenerateKey(nil)
	hash := "0x" + strings.Repeat("a", 64)
	addr := "0x" + strings.Repeat("1", 40)
	return WorkSpec{
		RunID: "run-20260906", DeadlineSeconds: 60,
		Selection: ObservedInput{Operator: addr, MarketID: hash, PoolManager: &deployment.ExternalRuntime{Address: "0x" + strings.Repeat("2", 40), RuntimeCodeHash: hash}, Participants: []Item{{User: "0x" + strings.Repeat("3", 40), CreatorEpoch: 7, MaximumMeme: "10"}}, PerBatchCap: "10", TotalMeme: "10"},
		Manifest:  deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 4663, GenesisHash: hash, Contracts: []deployment.Contract{{Module: "ProtocolFeeVault", Address: "0x" + strings.Repeat("4", 40), RuntimeCodeHash: hash}}},
		Policy:    ReferencePolicy{ChainID: 4663, GenesisHash: hash, MarketID: hash, MemeToken: "0x" + strings.Repeat("5", 40), QuoteAsset: "0x" + strings.Repeat("6", 40), MaxAgeSeconds: 30, MaxDeviationBps: 100, MinimumActiveLiquidity: "1", Sources: []ReferenceSource{{ID: "one", Endpoint: "https://one.example/price", PublicKey: base64.StdEncoding.EncodeToString(key1)}, {ID: "two", Endpoint: "https://two.example/price", PublicKey: base64.StdEncoding.EncodeToString(key2)}}},
	}
}

func TestWorkPayloadCanonicalAndValidated(t *testing.T) {
	spec := validWorkSpec(t)
	first, key, err := workPayload(spec)
	if err != nil || len(first) == 0 || len(key) != 64 {
		t.Fatalf("valid spec rejected: %v", err)
	}
	second, key2, err := workPayload(spec)
	if err != nil || string(first) != string(second) || key != key2 {
		t.Fatal("work payload is not deterministic")
	}

	cases := map[string]func(*WorkSpec){
		"run id":         func(s *WorkSpec) { s.RunID = "bad space" },
		"ttl low":        func(s *WorkSpec) { s.DeadlineSeconds = 29 },
		"ttl high":       func(s *WorkSpec) { s.DeadlineSeconds = 121 },
		"input deadline": func(s *WorkSpec) { s.Selection.Deadline = 1 },
		"quote":          func(s *WorkSpec) { s.Selection.Quote = &Quote{ExpectedOutput: "1"} },
		"references":     func(s *WorkSpec) { s.Selection.References = []SignedReference{{}} },
		"duplicate participant": func(s *WorkSpec) {
			s.Selection.Participants = append(s.Selection.Participants, s.Selection.Participants[0])
		},
		"zero cap":           func(s *WorkSpec) { s.Selection.PerBatchCap = "0" },
		"zero total":         func(s *WorkSpec) { s.Selection.TotalMeme = "0" },
		"duplicate endpoint": func(s *WorkSpec) { s.Policy.Sources[1].Endpoint = s.Policy.Sources[0].Endpoint },
		"duplicate key":      func(s *WorkSpec) { s.Policy.Sources[1].PublicKey = s.Policy.Sources[0].PublicKey },
		"scope":              func(s *WorkSpec) { s.Policy.MarketID = "0x" + strings.Repeat("b", 64) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			bad := validWorkSpec(t)
			mutate(&bad)
			if _, _, err := workPayload(bad); err == nil {
				t.Fatal("invalid work spec accepted")
			}
		})
	}
}
