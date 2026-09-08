package treasury

import (
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
)

func policyFixture(t *testing.T) EligibilityPolicy {
	t.Helper()
	_, _, lookup, _, _ := serviceFixture(t)
	in := lookup.candidate.Input
	h, err := PolicyHash(in.ChainID, in.MarketID, in.ExcludedAccounts)
	if err != nil {
		t.Fatal(err)
	}
	chain, _ := strconv.ParseUint(in.ChainID, 10, 64)
	return EligibilityPolicy{ChainID: chain, MarketID: in.MarketID, PolicyHash: h, ExcludedAccounts: in.ExcludedAccounts}
}

func TestDecodePoliciesCanonicalAndValidation(t *testing.T) {
	p := policyFixture(t)
	encoded, _ := json.Marshal([]EligibilityPolicy{p})
	got, err := DecodePolicies(encoded)
	if err != nil || len(got) != 1 || !reflect.DeepEqual(got[0], p) {
		t.Fatalf("valid policy: %#v %v", got, err)
	}

	other := p
	other.ChainID = 4663
	other.PolicyHash, _ = PolicyHash(strconv.FormatUint(other.ChainID, 10), other.MarketID, other.ExcludedAccounts)
	first, firstHash, err := canonicalPolicies([]EligibilityPolicy{p, other})
	if err != nil {
		t.Fatal(err)
	}
	second, secondHash, err := canonicalPolicies([]EligibilityPolicy{other, p})
	if err != nil || !reflect.DeepEqual(first, second) || firstHash != secondHash {
		t.Fatalf("canonical order is not deterministic: %#v %#v %v", first, second, err)
	}

	if got, err := DecodePolicies([]byte("[]")); err != nil || got == nil {
		t.Fatalf("explicit empty array should be allowed: %#v %v", got, err)
	}
	casePolicy := p
	casePolicy.MarketID = strings.ToUpper(p.MarketID)
	casePolicy.PolicyHash, _ = PolicyHash(strconv.FormatUint(casePolicy.ChainID, 10), strings.ToLower(casePolicy.MarketID), casePolicy.ExcludedAccounts)
	normalized, _, err := canonicalPolicies([]EligibilityPolicy{casePolicy})
	if err != nil || normalized[0].MarketID != p.MarketID {
		t.Fatalf("exclusion normalization failed: %#v %v", normalized, err)
	}

	withExclusions := p
	lower := "0x" + strings.Repeat("ab", 20)
	withExclusions.ExcludedAccounts = []string{lower, zero}
	withExclusions.PolicyHash, _ = PolicyHash(strconv.FormatUint(p.ChainID, 10), p.MarketID, withExclusions.ExcludedAccounts)
	_, expectedDigest, e := canonicalPolicies([]EligibilityPolicy{withExclusions})
	if e != nil {
		t.Fatal(e)
	}
	withExclusions.ExcludedAccounts = []string{zero, "0x" + strings.ToUpper(lower[2:]), lower}
	normalized, actualDigest, e := canonicalPolicies([]EligibilityPolicy{withExclusions})
	if e != nil || actualDigest != expectedDigest || !reflect.DeepEqual(normalized[0].ExcludedAccounts, []string{zero, lower}) {
		t.Fatal("exclusion order/case/dedup changed policy", e)
	}
	cases := []string{"null",
		`[{"chainId":46630,"marketId":"` + p.MarketID + `","policyHash":"` + p.PolicyHash + `"}]`,
		`[{"chainId":46630,"marketId":"` + p.MarketID + `","policyHash":"` + p.PolicyHash + `","excludedAccounts":null}]`,
		`[{"chainId":46630,"marketId":"` + p.MarketID + `","policyHash":"` + p.PolicyHash + `","excludedAccounts":[],"ExcludedAccounts":[]}]`,
		`[{"chainId":46630,"marketId":"` + p.MarketID + `","policyHash":"` + p.PolicyHash + `","excludedAccounts":[],"extra":1}]`,
	}
	for _, raw := range cases {
		if _, err := DecodePolicies([]byte(raw)); err == nil {
			t.Errorf("expected rejection: %s", raw)
		}
	}
	dup := "[" + string(encoded[1:len(encoded)-1]) + "," + string(encoded[1:len(encoded)-1]) + "]"
	if _, err := DecodePolicies([]byte(dup)); err == nil {
		t.Error("duplicate policy accepted")
	}
	for _, mutate := range []func(*EligibilityPolicy){func(x *EligibilityPolicy) { x.PolicyHash = "0x" + strings.Repeat("0", 64) }, func(x *EligibilityPolicy) { x.ChainID = 1 }} {
		x := p
		mutate(&x)
		b, _ := json.Marshal([]EligibilityPolicy{x})
		if _, err := DecodePolicies(b); err == nil {
			t.Error("bad policy accepted")
		}
	}
	if _, err := DecodePolicies([]byte(strings.Repeat("x", (1<<20)+1))); err == nil {
		t.Error("oversize policy accepted")
	}
}

func TestRequestEventMatchesAllFields(t *testing.T) {
	entry := requestLog{timestamp: 77}
	args := map[string]any{"requester": "0xreq", "sourceBlockNumber": "12", "sourceBlockHash": "0xhash", "quoteAmount": "99", "serviceFeeAsset": "0xfee", "serviceFeeAmount": "3", "publishBy": "88", "windowStart": "100", "windowEnd": "200"}
	o := deployment.TreasuryRequestSnapshot{Epoch: map[string]any{"requestedAt": "77", "requester": "0xreq", "sourceBlockNumber": "12", "sourceBlockHash": "0xhash", "quoteAmount": "99", "serviceFeeAsset": "0xfee", "serviceFeeAmount": "3", "publishBy": "88"}, Window: map[string]any{"start": "100", "end": "200"}}
	if !requestEventMatches(entry, args, o) {
		t.Fatal("matching request rejected")
	}
	for key := range args {
		bad := map[string]any{}
		for k, v := range args {
			bad[k] = v
		}
		bad[key] = "mismatch"
		if requestEventMatches(entry, bad, o) {
			t.Errorf("mismatch accepted for %s", key)
		}
	}
	bad := o
	bad.Epoch = map[string]any{}
	if requestEventMatches(entry, args, bad) {
		t.Error("missing requestedAt accepted")
	}
}
