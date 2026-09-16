package deployment

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

// MarketIdentity is a canonical end-of-block token display observation. It is
// not a complete market projection or authorization to fetch the metadata URI.
type MarketIdentity struct {
	ChainID         uint64 `json:"chainId"`
	BlockNumber     string `json:"blockNumber"`
	BlockHash       string `json:"blockHash"`
	MarketID        string `json:"marketId"`
	MemeToken       string `json:"memeToken"`
	RuntimeCodeHash string `json:"runtimeCodeHash"`
	Name            string `json:"name"`
	Symbol          string `json:"symbol"`
	MetadataURI     string `json:"metadataURI"`
	DeployedAt      string `json:"deployedAt"`
}

func ObserveMarketIdentity(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, id string) (MarketIdentity, error) {
	fail := func(e error) (MarketIdentity, error) { return MarketIdentity{}, e }
	id = strings.ToLower(id)
	if !hex32.MatchString(id) || id == zero32 {
		return fail(errors.New("invalid market identity target"))
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if _, e := VerifyCoreBindings(ctx, rpc, m, block); e != nil {
		return fail(e)
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		roots[c.Module] = c.Address
	}
	read := businessReader(ctx, rpc, block)
	state, e := read(roots["MarketRegistryV1"], "market(bytes32)", id[2:], marketFields)
	if e != nil {
		return fail(e)
	}
	if e = validateMarketState(state); e != nil {
		return fail(e)
	}
	token := state["memeToken"].(string)
	scalar := func(address, signature, args, typ string) (string, error) {
		v, e := read(address, signature, args, []events.Input{{Name: "value", Type: typ}})
		if e != nil {
			return "", e
		}
		return v["value"].(string), nil
	}
	for _, edge := range []struct{ address, signature, args, typ, want string }{
		{roots["MarketRegistryV1"], "marketIdByToken(address)", strings.Repeat("0", 24) + token[2:], "bytes32", id},
		{token, "marketId()", "", "bytes32", id},
		{token, "factory()", "", "address", roots["TickerGardenFactoryV1"]},
	} {
		got, e := scalar(edge.address, edge.signature, edge.args, edge.typ)
		if e != nil {
			return fail(e)
		}
		if got != edge.want {
			return fail(errors.New("market token identity mismatch"))
		}
	}
	code, e := rpc.CodeAt(ctx, token, block.Hash)
	if e != nil || len(code) == 0 {
		return fail(errors.New("market token runtime unavailable"))
	}
	result := MarketIdentity{ChainID: m.ChainID, BlockNumber: block.Number, BlockHash: block.Hash, MarketID: id, MemeToken: token, RuntimeCodeHash: Hash(code)}
	for _, field := range []struct {
		signature string
		max       int
		target    *string
	}{{"name()", 4096, &result.Name}, {"symbol()", 4096, &result.Symbol}, {"metadataURI()", 16384, &result.MetadataURI}} {
		raw, e := rpc.CallAt(ctx, token, Hash([]byte(field.signature))[:10], block.Hash)
		if e != nil {
			return fail(e)
		}
		text, e := chainrpc.DecodeABIString(raw, field.max)
		if e != nil {
			return fail(e)
		}
		*field.target = text
	}
	deployed, e := scalar(token, "deployedAt()", "", "uint64")
	if e != nil {
		return fail(e)
	}
	at, e := strconv.ParseUint(deployed, 10, 64)
	now, timeErr := block.Time()
	if e != nil || timeErr != nil || at > now {
		return fail(errors.New("market deployment timestamp invalid"))
	}
	result.DeployedAt = deployed
	last, e := rpc.Header(ctx, block.Number)
	if e != nil || last.Hash != block.Hash || last.Timestamp != block.Timestamp {
		return fail(errors.New("market identity observation changed"))
	}
	return result, nil
}
