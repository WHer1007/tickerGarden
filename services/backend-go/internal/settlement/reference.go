package settlement

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
)

// ReferencePolicy is trusted operator configuration, never supplied by the
// candidate or a quote provider. Sources must be independently vetted off-chain.
type ReferencePolicy struct {
	AllowLoopbackHTTP      bool              `json:"allowLoopbackHttp,omitempty"`
	ChainID                uint64            `json:"chainId"`
	GenesisHash            string            `json:"genesisHash"`
	MarketID               string            `json:"marketId"`
	MemeToken              string            `json:"memeToken"`
	QuoteAsset             string            `json:"quoteAsset"`
	Sources                []ReferenceSource `json:"sources"`
	MaxAgeSeconds          int64             `json:"maxAgeSeconds"`
	MaxDeviationBps        int               `json:"maxDeviationBps"`
	MinimumActiveLiquidity string            `json:"minimumActiveLiquidity"`
}
type ReferenceSource struct {
	Endpoint  string `json:"endpoint,omitempty"`
	ID        string `json:"id"`
	PublicKey string `json:"publicKey"`
}
type ReferencePrice struct {
	Version       string `json:"version"`
	SourceID      string `json:"sourceId"`
	ChainID       uint64 `json:"chainId"`
	GenesisHash   string `json:"genesisHash"`
	MarketID      string `json:"marketId"`
	MemeToken     string `json:"memeToken"`
	QuoteAsset    string `json:"quoteAsset"`
	RequestDigest string `json:"requestDigest"`
	ObservedAt    int64  `json:"observedAt"`
	ExpiresAt     int64  `json:"expiresAt"`
	QuoteUnits    string `json:"quoteUnits"`
	MemeUnits     string `json:"memeUnits"`
}
type SignedReference struct {
	Price     ReferencePrice `json:"price"`
	Signature string         `json:"signature"`
}
type ReferenceCheck struct {
	Policy     ReferencePolicy   `json:"policy"`
	References []SignedReference `json:"references"`
	Sources    []string          `json:"sources"`
	CheckedAt  int64             `json:"checkedAt"`
	// All ratios use the smallest units of the exact bound assets, no decimals.
	MinimumReceived string `json:"minimumReceived"`
}

var referenceSourceIDPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,128}$`)

var ErrReference = errors.New("settlement independent reference check failed")

// ReferenceSigningMessage defines a stable versioned ordered JSON signature
// domain. It signs price assertions, not settlement transactions.
func ReferenceSigningMessage(p ReferencePrice) ([]byte, error) { return json.Marshal(p) }

// CheckReferences is a veto gate. It never edits calldata, minimumQuote or asset
// amounts. A successful signature proves origin, not provider independence.
func CheckReferences(p ConversionPreview, policy ReferencePolicy, refs []SignedReference, now int64) (ReferenceCheck, error) {
	fail := func() (ReferenceCheck, error) { return ReferenceCheck{}, ErrReference }
	if now < 0 || len(policy.Sources) < 2 || len(policy.Sources) > 8 || len(refs) != len(policy.Sources) || policy.MaxAgeSeconds < 1 || policy.MaxAgeSeconds > 60 || policy.MaxDeviationBps < 0 || policy.MaxDeviationBps > 100 {
		return fail()
	}
	keys, e := referencePolicyKeys(p, policy)
	if e != nil {
		return fail()
	}
	state := p.Candidate.State
	if p.Candidate.Plan == nil || len(p.Candidate.Plan.Batches) != 1 {
		return fail()
	}
	stamp, e := state.Block.Time()
	if e != nil || stamp > uint64(now+5) || now-int64(stamp) > 120 || p.Candidate.Plan.Deadline < now {
		return fail()
	}
	spent, e := amount(p.Spent)
	if e != nil || spent.Sign() == 0 {
		return fail()
	}
	received, e := amount(p.Received)
	if e != nil {
		return fail()
	}
	total, e := amount(p.Candidate.Request.TotalMeme)
	if e != nil || total.Sign() == 0 || spent.Cmp(total) > 0 {
		return fail()
	}
	minQuote, e := amount(p.Candidate.Plan.MinimumQuote)
	if e != nil || minQuote.Sign() == 0 {
		return fail()
	}
	seen := map[string]bool{}
	result := ReferenceCheck{Sources: []string{}, CheckedAt: now, MinimumReceived: "0"}
	lowerBound := new(big.Int)
	for _, signed := range refs {
		r := signed.Price
		key := keys[r.SourceID]
		if key == nil || seen[r.SourceID] || r.Version != "tickergarden-conversion-reference-v1" || r.ChainID != state.ChainID || r.GenesisHash != state.GenesisHash || r.MarketID != state.MarketID || r.MemeToken != state.MemeToken || r.QuoteAsset != state.QuoteAsset || r.RequestDigest != p.Candidate.Request.RequestDigest || r.RequestDigest != p.Candidate.Plan.RequestDigest || r.ObservedAt < 0 || r.ObservedAt > now || now-r.ObservedAt > policy.MaxAgeSeconds || r.ExpiresAt < now || r.ExpiresAt < r.ObservedAt || r.ExpiresAt-r.ObservedAt > policy.MaxAgeSeconds {
			return fail()
		}
		message, e := ReferenceSigningMessage(r)
		if e != nil {
			return fail()
		}
		signature, e := base64.StdEncoding.DecodeString(signed.Signature)
		if e != nil || !ed25519.Verify(key, message, signature) {
			return fail()
		}
		quote, e := amount(r.QuoteUnits)
		if e != nil || quote.Sign() == 0 {
			return fail()
		}
		meme, e := amount(r.MemeUnits)
		if e != nil || meme.Sign() == 0 {
			return fail()
		}
		// Compare ratios with full-precision cross products; no lossy division.
		actual := new(big.Int).Mul(new(big.Int).Mul(received, meme), big.NewInt(10000))
		fair := new(big.Int).Mul(spent, quote)
		low := new(big.Int).Mul(fair, big.NewInt(int64(10000-policy.MaxDeviationBps)))
		high := new(big.Int).Mul(fair, big.NewInt(int64(10000+policy.MaxDeviationBps)))
		if actual.Cmp(low) < 0 || actual.Cmp(high) > 0 {
			return fail()
		}
		// Only evaluate the observed simulated fill. Inclusion-time execution must
		// refresh this gate; a partial fill does not attest the full requested amount.
		protected := new(big.Int).Mul(new(big.Int).Mul(minQuote, meme), big.NewInt(10000))
		if protected.Cmp(low) < 0 {
			return fail()
		}
		denominator := new(big.Int).Mul(meme, big.NewInt(10000))
		minimum := new(big.Int).Div(new(big.Int).Add(low, new(big.Int).Sub(denominator, big.NewInt(1))), denominator)
		if minimum.Cmp(lowerBound) > 0 {
			lowerBound = minimum
		}
		seen[r.SourceID] = true
		result.Sources = append(result.Sources, r.SourceID)
	}
	result.Policy = policy
	result.Policy.Sources = append([]ReferenceSource{}, policy.Sources...)
	result.References = append([]SignedReference{}, refs...)
	result.MinimumReceived = lowerBound.String()
	return result, nil
}

func referencePolicyKeys(p ConversionPreview, policy ReferencePolicy) (map[string]ed25519.PublicKey, error) {
	keys, e := configuredReferenceKeys(policy)
	if e != nil {
		return nil, e
	}
	threshold, _ := amount(policy.MinimumActiveLiquidity)
	liquidity, e := amount(p.Route.PoolState.ActiveLiquidity)
	if e != nil || liquidity.Cmp(threshold) < 0 {
		return nil, ErrReference
	}
	state := p.Candidate.State
	if policy.ChainID != state.ChainID || policy.GenesisHash != state.GenesisHash || policy.MarketID != state.MarketID || policy.MemeToken != state.MemeToken || policy.QuoteAsset != state.QuoteAsset {
		return nil, ErrReference
	}

	return keys, nil
}

func configuredReferenceKeys(policy ReferencePolicy) (map[string]ed25519.PublicKey, error) {
	if len(policy.Sources) < 2 || len(policy.Sources) > 8 || policy.MaxAgeSeconds < 1 || policy.MaxAgeSeconds > 60 || policy.MaxDeviationBps < 0 || policy.MaxDeviationBps > 100 {
		return nil, ErrReference
	}
	_, e := amount(policy.MinimumActiveLiquidity)
	if e != nil {
		return nil, ErrReference
	}
	keys := map[string]ed25519.PublicKey{}
	seenKeys := map[string]bool{}
	for _, source := range policy.Sources {
		key, e := base64.StdEncoding.DecodeString(source.PublicKey)
		if (source.Endpoint != "" && !referenceEndpointAllowed(source.Endpoint, policy.AllowLoopbackHTTP)) || !referenceSourceIDPattern.MatchString(source.ID) || len(key) != ed25519.PublicKeySize || e != nil || keys[source.ID] != nil || seenKeys[string(key)] {
			return nil, ErrReference
		}
		keys[source.ID] = ed25519.PublicKey(key)
		seenKeys[string(key)] = true
	}
	return keys, nil
}
