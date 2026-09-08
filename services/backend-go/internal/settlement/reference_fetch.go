package settlement

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrReferenceFetch = errors.New("settlement reference provider unavailable or invalid")

// FetchReferences makes one bounded request to every explicitly configured
// provider. No redirects, retries, fallback sources or candidate-selected URLs.
func FetchReferences(ctx context.Context, p ConversionPreview, policy ReferencePolicy) (ReferenceCheck, error) {
	return fetchReferences(ctx, p, policy, nil)
}
func fetchReferences(ctx context.Context, p ConversionPreview, policy ReferencePolicy, transport http.RoundTripper) (ReferenceCheck, error) {
	if _, e := referencePolicyKeys(p, policy); e != nil {
		return ReferenceCheck{}, e
	}
	endpoints := map[string]bool{}
	for _, source := range policy.Sources {
		u, e := url.Parse(source.Endpoint)
		if e != nil || !referenceEndpointAllowed(source.Endpoint, policy.AllowLoopbackHTTP) {
			return ReferenceCheck{}, ErrReferenceFetch
		}
		if endpoints[u.String()] {
			return ReferenceCheck{}, ErrReferenceFetch
		}
		endpoints[u.String()] = true
	}
	state := p.Candidate.State
	requestBody, e := json.Marshal(struct {
		Version       string `json:"version"`
		ChainID       uint64 `json:"chainId"`
		GenesisHash   string `json:"genesisHash"`
		MarketID      string `json:"marketId"`
		MemeToken     string `json:"memeToken"`
		QuoteAsset    string `json:"quoteAsset"`
		RequestDigest string `json:"requestDigest"`
	}{"tickergarden-conversion-reference-request-v1", state.ChainID, state.GenesisHash, state.MarketID, state.MemeToken, state.QuoteAsset, p.Candidate.Request.RequestDigest})
	if e != nil {
		return ReferenceCheck{}, ErrReferenceFetch
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 15 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	type response struct {
		index int
		ref   SignedReference
		err   error
	}
	results := make(chan response, len(policy.Sources))
	for i, source := range policy.Sources {
		go func(i int, source ReferenceSource) {
			ref, e := fetchReference(ctx, client, source, requestBody)
			results <- response{i, ref, e}
		}(i, source)
	}
	refs := make([]SignedReference, len(policy.Sources))
	failed := false
	for range policy.Sources {
		result := <-results
		if result.err != nil {
			failed = true
			cancel()
		} else {
			refs[result.index] = result.ref
		}
	}
	if failed {
		return ReferenceCheck{}, ErrReferenceFetch
	}
	return CheckReferences(p, policy, refs, time.Now().Unix())
}
func fetchReference(ctx context.Context, client *http.Client, source ReferenceSource, body []byte) (SignedReference, error) {
	fail := func() (SignedReference, error) { return SignedReference{}, ErrReferenceFetch }
	request, e := http.NewRequestWithContext(ctx, http.MethodPost, source.Endpoint, bytes.NewReader(body))
	if e != nil {
		return fail()
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, e := client.Do(request)
	if e != nil {
		return fail()
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.EqualFold(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]), "application/json") {
		return fail()
	}
	raw, e := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if e != nil || len(raw) > 64<<10 {
		return fail()
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var ref SignedReference
	if e := decoder.Decode(&ref); e != nil {
		return fail()
	}
	if decoder.Decode(new(any)) != io.EOF || ref.Price.SourceID != source.ID {
		return fail()
	}
	return ref, nil
}

func referenceEndpointAllowed(endpoint string, allowLoopback bool) bool {
	u, e := url.Parse(endpoint)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	ip := net.ParseIP(u.Hostname())
	return u.Scheme == "http" && allowLoopback && ip != nil && ip.IsLoopback()
}
