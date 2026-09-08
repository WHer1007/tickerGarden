package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/treasury"
)

type stubClaimProof struct {
	proof                 treasury.ClaimProof
	err                   error
	gotMarket, gotAccount string
	gotEpoch              uint32
}

func (s *stubClaimProof) ClaimProof(_ context.Context, market string, epoch uint32, account string) (treasury.ClaimProof, error) {
	s.gotMarket, s.gotEpoch, s.gotAccount = market, epoch, account
	return s.proof, s.err
}
func testProof() treasury.ClaimProof {
	return treasury.ClaimProof{Schema: "TICKERGARDEN_V1_TREASURY_CLAIM_PROOF_V1", ExecutionSpecID: "V1-TREASURY-EXEC-1", ChainID: 46630, Distributor: "0x1111111111111111111111111111111111111111", MarketID: "0x" + strings.Repeat("ab", 32), EpochID: 7, LeafIndex: "2", Account: "0x2222222222222222222222222222222222222222", Twab: "100", Amount: "9", MerkleRoot: "0x" + strings.Repeat("cd", 32), DatasetHash: "0x" + strings.Repeat("ef", 32), Proof: []string{"0x" + strings.Repeat("01", 32)}}
}
func TestTreasuryProofHTTP(t *testing.T) {
	market := "0x" + strings.Repeat("ab", 32)
	account := "0x" + strings.Repeat("22", 20)
	path := "/v1/treasury/markets/" + market + "/epochs/7/claims/" + account
	t.Run("success normalizes and serializes strings", func(t *testing.T) {
		s := &stubClaimProof{proof: testProof()}
		h := New(Options{ChainID: 46630, TreasuryProofs: s})
		w := httptest.NewRecorder()
		upper := "/v1/treasury/markets/0x" + strings.Repeat("AB", 32) + "/epochs/7/claims/0x" + strings.Repeat("22", 20)
		h.ServeHTTP(w, httptest.NewRequest("GET", upper, nil))
		if w.Code != 200 {
			t.Fatalf("status %d", w.Code)
		}

		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"leafIndex", "twab", "amount"} {
			if _, ok := body[key].(string); !ok {
				t.Fatalf("%s must be decimal string", key)
			}
		}
		if _, ok := body["proof"].([]any); !ok {
			t.Fatal("missing proof array")
		}
		if s.gotMarket != market || s.gotAccount != account || s.gotEpoch != 7 {
			t.Fatalf("args %q %d %q", s.gotMarket, s.gotEpoch, s.gotAccount)
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("cache")
		}
	})
	for _, tc := range []struct {
		name, method, url string
		err               error
		code              int
	}{
		{"zero account", "GET", "/v1/treasury/markets/" + market + "/epochs/7/claims/0x" + strings.Repeat("0", 40), nil, 400},
		{"zero market", "GET", "/v1/treasury/markets/0x" + strings.Repeat("0", 64) + "/epochs/7/claims/" + account, nil, 400},
		{"zero epoch", "GET", "/v1/treasury/markets/" + market + "/epochs/0/claims/" + account, nil, 400},
		{"malformed", "GET", "/v1/treasury/markets/nope", nil, 400}, {"overflow", "GET", "/v1/treasury/markets/0x" + strings.Repeat("ab", 32) + "/epochs/4294967296/claims/0x" + strings.Repeat("22", 20), nil, 400}, {"zero query", "GET", path + "?x=1", nil, 400}, {"nil", "GET", path, nil, 503}, {"internal", "GET", path, errors.New("secret backend detail"), 503}, {"missing", "GET", path, treasury.ErrProofNotFound, 404}, {"not claiming", "GET", path, deployment.ErrTreasuryNotClaiming, 409}, {"claimed", "GET", path, treasury.ErrProofClaimed, 409}, {"expired", "GET", path, deployment.ErrTreasuryExpired, 410}, {"post", "POST", path, nil, 405},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var r TreasuryProofReader
			if tc.name == "nil" {
				r = nil
			} else {
				r = &stubClaimProof{err: tc.err, proof: testProof()}
			}
			h := New(Options{ChainID: 46630, TreasuryProofs: r})
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.url, nil))
			if w.Code != tc.code {
				t.Fatalf("got %d want %d body %s", w.Code, tc.code, w.Body)
			}
			if tc.name == "internal" && strings.Contains(w.Body.String(), "secret") {
				t.Fatal("leaked error")
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing no-store")
			}
		})
	}
	t.Run("chain mismatch", func(t *testing.T) {
		s := &stubClaimProof{proof: testProof()}
		p := s.proof
		p.ChainID = 4663
		s.proof = p
		w := httptest.NewRecorder()
		New(Options{ChainID: 46630, TreasuryProofs: s}).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 503 {
			t.Fatalf("%d", w.Code)
		}
	})
	t.Run("cors", func(t *testing.T) {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Origin", "https://app.example")
		New(Options{ChainID: 46630, TreasuryProofs: &stubClaimProof{proof: testProof()}, AllowedOrigin: "https://app.example"}).ServeHTTP(w, r)
		if w.Header().Get("Access-Control-Allow-Origin") != "https://app.example" {
			t.Fatal("cors")
		}
	})
}
