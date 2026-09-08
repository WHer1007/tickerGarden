// Package observationwork schedules hash-pinned heavy observations. Results are
// scoped evidence only; the existing financial publisher still requires all inputs.
package observationwork

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

const Version = "fee-holder-work-v1"

var ErrPending = errors.New("scoped observations pending")

type Request struct {
	Version    string                                `json:"version"`
	Kind       string                                `json:"kind"`
	Manifest   deployment.Manifest                   `json:"manifest"`
	Block      chainrpc.Header                       `json:"block"`
	Markets    map[string]deployment.MarketDiscovery `json:"markets"`
	Historical []deployment.ServiceAssetTarget       `json:"historical"`
}

func Digest(b []byte) string { s := sha256.Sum256(b); return "0x" + hex.EncodeToString(s[:]) }
func (r Request) Encode() ([]byte, string, error) {
	if r.Version != Version || (r.Kind != "fees" && r.Kind != "holders") || len(r.Markets) > 4096 {
		return nil, "", errors.New("invalid observation work scope")
	}
	b, e := json.Marshal(r.Manifest)
	if e != nil {
		return nil, "", e
	}
	if _, e = deployment.Parse(b); e != nil {
		return nil, "", e
	}
	if _, e = r.Block.Height(); e != nil {
		return nil, "", e
	}
	if _, e = r.Block.Time(); e != nil {
		return nil, "", e
	}
	if !regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`).MatchString(r.Block.Hash) {
		return nil, "", errors.New("invalid observation block")
	}
	b, e = json.Marshal(r)
	if e != nil || len(b) > 8<<20 {
		return nil, "", errors.New("observation request exceeds budget")
	}
	return b, Digest(b), nil
}

// Connected markets share a custody/accounting dependency. In particular, two
// ETH-quoted markets MUST NOT be presented as independent solvency groups.
// Historical service assets without market attribution force one conservative group.
func Plan(m deployment.Manifest, b chainrpc.Header, markets map[string]deployment.MarketDiscovery, historical []deployment.ServiceAssetTarget) ([]Request, error) {
	if len(markets) > 4096 {
		return nil, errors.New("market scope exceeds work budget")
	}
	ids := make([]string, 0, len(markets))
	for id := range markets {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	parents := make([]int, len(ids))
	for i := range parents {
		parents[i] = i
	}
	var root func(int) int
	root = func(i int) int {
		if parents[i] != i {
			parents[i] = root(parents[i])
		}
		return parents[i]
	}
	dependencies := map[string]int{}
	for i, id := range ids {
		market := markets[id]
		if market.MarketID != id {
			return nil, errors.New("market identity mismatch")
		}
		keys := []string{}
		for _, field := range []string{"quoteAsset", "memeToken"} {
			a, ok := market.State[field].(string)
			if !ok || !regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`).MatchString(a) {
				return nil, errors.New("market accounting asset missing")
			}
			keys = append(keys, "token:"+strings.ToLower(a))
		}
		if market.State["stakingEnabled"] == true {
			a, ok := market.State["assetUid"].(string)
			if !ok || !regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`).MatchString(a) {
				return nil, errors.New("stock accounting dependency missing")
			}
			keys = append(keys, "stock:"+strings.ToLower(a))
		}
		if len(historical) > 0 {
			keys = append(keys, "historical-service-shared")
		}
		for _, key := range keys {
			if j, ok := dependencies[key]; ok {
				parents[root(i)] = root(j)
			} else {
				dependencies[key] = i
			}
		}
	}
	groups := map[int]map[string]deployment.MarketDiscovery{}
	for i, id := range ids {
		r := root(i)
		if groups[r] == nil {
			groups[r] = map[string]deployment.MarketDiscovery{}
		}
		groups[r][id] = markets[id]
	}
	if len(groups) == 0 {
		groups[0] = map[string]deployment.MarketDiscovery{}
	}
	roots := make([]int, 0, len(groups))
	for r := range groups {
		roots = append(roots, r)
	}
	sort.Ints(roots)
	m.Contracts = append([]deployment.Contract{}, m.Contracts...)
	sort.Slice(m.Contracts, func(i, j int) bool { return m.Contracts[i].Address < m.Contracts[j].Address })
	out := []Request{}
	for _, r := range roots {
		for _, kind := range []string{"fees", "holders"} {
			req := Request{Version: Version, Kind: kind, Manifest: m, Block: b, Markets: groups[r], Historical: historical}
			if _, _, e := req.Encode(); e != nil {
				return nil, e
			}
			out = append(out, req)
		}
	}
	return out, nil
}
