package settlement

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"time"
)

func signReference(t *testing.T, p ReferencePrice, key ed25519.PrivateKey) SignedReference {
	t.Helper()
	m, e := ReferenceSigningMessage(p)
	if e != nil {
		t.Fatal(e)
	}
	return SignedReference{Price: p, Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, m))}
}
func referenceFixture(t *testing.T) (ConversionPreview, ReferencePolicy, []SignedReference, []ed25519.PrivateKey, int64) {
	t.Helper()
	now := time.Now().Unix()
	digest := "0x" + strings.Repeat("c", 64)
	state := deployment.RewardConversionState{ChainID: 4663, GenesisHash: "0x" + strings.Repeat("a", 64), MarketID: "0x" + strings.Repeat("b", 64), MemeToken: "0x" + strings.Repeat("1", 40), QuoteAsset: "0x" + strings.Repeat("2", 40), Block: chainrpc.Header{Number: "0x1", Hash: "0x" + strings.Repeat("d", 64), Timestamp: fmt.Sprintf("0x%x", now)}}
	preview := ConversionPreview{Candidate: ObservedCandidate{State: state, Request: Request{RequestDigest: digest, TotalMeme: "10"}, Plan: &Plan{Batches: []Batch{{}}, RequestDigest: digest, MinimumQuote: "99", Deadline: now + 100}}, Route: deployment.RewardConversionRoute{PoolState: deployment.ConversionPoolState{ActiveLiquidity: "100"}}, Spent: "10", Received: "100"}
	policy := ReferencePolicy{ChainID: state.ChainID, GenesisHash: state.GenesisHash, MarketID: state.MarketID, MemeToken: state.MemeToken, QuoteAsset: state.QuoteAsset, MaxAgeSeconds: 30, MaxDeviationBps: 100, MinimumActiveLiquidity: "1"}
	refs := []SignedReference{}
	keys := []ed25519.PrivateKey{}
	for _, id := range []string{"one", "two"} {
		pub, key, e := ed25519.GenerateKey(rand.Reader)
		if e != nil {
			t.Fatal(e)
		}
		keys = append(keys, key)
		policy.Sources = append(policy.Sources, ReferenceSource{ID: id, PublicKey: base64.StdEncoding.EncodeToString(pub)})
		price := ReferencePrice{Version: "tickergarden-conversion-reference-v1", SourceID: id, ChainID: state.ChainID, GenesisHash: state.GenesisHash, MarketID: state.MarketID, MemeToken: state.MemeToken, QuoteAsset: state.QuoteAsset, RequestDigest: digest, ObservedAt: now, ExpiresAt: now + 30, QuoteUnits: "10", MemeUnits: "1"}
		refs = append(refs, signReference(t, price, key))
	}
	return preview, policy, refs, keys, now
}
func TestReferencesSuccessPartialAndBoundaries(t *testing.T) {
	p, policy, refs, _, now := referenceFixture(t)
	got, e := CheckReferences(p, policy, refs, now)
	if e != nil || len(got.Sources) != 2 || got.MinimumReceived != "99" {
		t.Fatalf("%+v %v", got, e)
	}
	p.Spent = "5"
	p.Received = "50"
	p.Candidate.Plan.MinimumQuote = "50"
	got, e = CheckReferences(p, policy, refs, now)
	if e != nil || got.MinimumReceived != "50" {
		t.Fatal(got, e)
	}
	p.Spent = "10"
	p.Candidate.Plan.MinimumQuote = "99"
	for _, value := range []string{"99", "101"} {
		p.Received = value
		if _, e := CheckReferences(p, policy, refs, now); e != nil {
			t.Fatal(e)
		}
	}
}
func TestReferencesRejectWithoutPartialResult(t *testing.T) {
	for _, kind := range []string{"signature", "same keys", "same IDs", "missing", "chain", "genesis", "market", "meme", "quote", "digest", "stale", "future", "expired", "ratio", "zero ratio", "under price", "over price", "minimum", "liquidity", "source", "version", "age policy", "deviation policy", "noncanonical amount", "policy scope"} {
		t.Run(kind, func(t *testing.T) {
			p, policy, refs, keys, now := referenceFixture(t)
			r := &refs[0].Price
			switch kind {
			case "policy scope":
				policy.MarketID = "0x" + strings.Repeat("f", 64)
			case "same keys":
				policy.Sources[1].PublicKey = policy.Sources[0].PublicKey
			case "same IDs":
				policy.Sources[1].ID = policy.Sources[0].ID
			case "missing":
				refs = refs[:1]
			case "chain":
				r.ChainID++
			case "genesis":
				r.GenesisHash = "0x" + strings.Repeat("f", 64)
			case "market":
				r.MarketID = "0x" + strings.Repeat("f", 64)
			case "meme":
				r.MemeToken = p.Candidate.State.QuoteAsset
			case "quote":
				r.QuoteAsset = p.Candidate.State.MemeToken
			case "digest":
				r.RequestDigest = "0x" + strings.Repeat("f", 64)
			case "stale":
				r.ObservedAt = now - 31
				r.ExpiresAt = now
			case "future":
				r.ObservedAt = now + 1
				r.ExpiresAt = now + 20
			case "expired":
				r.ObservedAt = now - 10
				r.ExpiresAt = now - 1
			case "ratio":
				r.QuoteUnits = "20"
			case "zero ratio":
				r.MemeUnits = "0"
			case "under price":
				p.Received = "98"
			case "over price":
				p.Received = "102"
			case "minimum":
				p.Candidate.Plan.MinimumQuote = "98"
			case "liquidity":
				policy.MinimumActiveLiquidity = "101"
			case "source":
				r.SourceID = "unknown"
			case "version":
				r.Version = "v2"
			case "age policy":
				policy.MaxAgeSeconds = 61
			case "deviation policy":
				policy.MaxDeviationBps = 101
			case "noncanonical amount":
				r.QuoteUnits = "010"
			}
			for i := range refs {
				refs[i] = signReference(t, refs[i].Price, keys[i])
			}
			if kind == "signature" {
				refs[0].Signature = "AAAA"
			}
			result, e := CheckReferences(p, policy, refs, now)
			if e == nil || result.Sources != nil {
				t.Fatalf("accepted %s: %+v %v", kind, result, e)
			}
		})
	}
}

func TestReferenceExactAgeAndZeroDeviation(t *testing.T) {
	p, policy, refs, _, now := referenceFixture(t)
	if _, e := CheckReferences(p, policy, refs, now+30); e != nil {
		t.Fatal("exact expiry rejected", e)
	}
	if _, e := CheckReferences(p, policy, refs, now+31); e == nil {
		t.Fatal("expired accepted")
	}
	policy.MaxDeviationBps = 0
	policy.MinimumActiveLiquidity = "100"
	p.Candidate.Plan.MinimumQuote = "100"
	if _, e := CheckReferences(p, policy, refs, now); e != nil {
		t.Fatal(e)
	}
	p.Received = "101"
	if _, e := CheckReferences(p, policy, refs, now); e == nil {
		t.Fatal("zero-deviation mismatch accepted")
	}
}
