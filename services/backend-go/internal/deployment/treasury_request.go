package deployment

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strconv"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

// TreasuryRequestSnapshot is a hash-pinned epoch observation. The request
// observer requires REQUESTED; the claim observer requires CLAIMING. Neither
// observation authorizes publication or attests Transfer-history completeness.
type TreasuryRequestSnapshot struct {
	ChainID         uint64         `json:"chainId"`
	BlockHash       string         `json:"blockHash"`
	BlockNumber     string         `json:"blockNumber"`
	Distributor     string         `json:"distributor"`
	MarketID        string         `json:"marketId"`
	EpochID         uint32         `json:"epochId"`
	Market          map[string]any `json:"market"`
	Epoch           map[string]any `json:"epoch"`
	Window          map[string]any `json:"window"`
	EpochDuration   string         `json:"epochDuration"`
	TwabSchema      string         `json:"twabSchema"`
	SourceTimestamp string         `json:"sourceTimestamp"`
}

func ObserveTreasuryRequest(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, marketID string, epochID uint32) (TreasuryRequestSnapshot, error) {
	return observeTreasuryEpoch(ctx, rpc, m, block, marketID, epochID, "request")
}

var ErrTreasuryRequestInactive = errors.New("Treasury epoch is no longer REQUESTED")
var ErrTreasuryRequestExpired = errors.New("Treasury request publication window expired")

var ErrTreasuryNotClaiming = errors.New("Treasury epoch is not in CLAIMING state")
var ErrTreasuryExpired = errors.New("Treasury claim window expired")

// ObserveTreasuryClaimEpoch verifies the published claim domain at one canonical block.
func ObserveTreasuryClaimEpoch(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, marketID string, epochID uint32) (TreasuryRequestSnapshot, error) {
	return observeTreasuryEpoch(ctx, rpc, m, block, marketID, epochID, "claim")
}

// ObserveTreasuryPendingEpoch verifies a ROOT_PENDING commitment, including empty
// rollover roots, without imposing the already-closed publication deadline.
func ObserveTreasuryPendingEpoch(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, marketID string, epochID uint32) (TreasuryRequestSnapshot, error) {
	return observeTreasuryEpoch(ctx, rpc, m, block, marketID, epochID, "pending")
}

func observeTreasuryEpoch(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, marketID string, epochID uint32, mode string) (TreasuryRequestSnapshot, error) {
	fail := func(e error) (TreasuryRequestSnapshot, error) { return TreasuryRequestSnapshot{}, e }
	if !hex32.MatchString(marketID) || marketID == zero32 || epochID == 0 {
		return fail(errors.New("invalid Treasury request target"))
	}
	now, e := block.Time()
	if e != nil {
		return fail(e)
	}
	height, e := block.Height()
	if e != nil {
		return fail(e)
	}
	if _, e = VerifyCoreBindings(ctx, rpc, m, block); e != nil {
		return fail(e)
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		roots[c.Module] = c.Address
	}
	distributor := roots["TreasuryDistributorV1"]
	if distributor == "" {
		return fail(errors.New("Treasury request requires a pinned distributor manifest"))
	}
	args := marketID[2:] + fmt.Sprintf("%064x", epochID)
	var batch []chainrpc.StateCall
	for _, call := range [][3]string{
		{roots["TickerGardenFactoryV1"], "treasuryDistributor()", ""},
		{distributor, "marketRegistry()", ""},
		{roots["MarketRegistryV1"], "market(bytes32)", marketID[2:]},
		{distributor, "market(bytes32)", marketID[2:]},
		{distributor, "epoch(bytes32,uint32)", args},
		{distributor, "epochQuoteAmount(bytes32,uint32)", args},
		{distributor, "epochWindow(bytes32,uint32)", args},
		{distributor, "EPOCH_DURATION()", ""},
		{distributor, "TWAB_SCHEMA()", ""},
	} {
		batch = append(batch, chainrpc.StateCall{Address: call[0], Data: Hash([]byte(call[1]))[:10] + call[2]})
	}
	rpc, e = prefetchCalls(ctx, rpc, block.Hash, batch)
	if e != nil {
		return fail(e)
	}
	read := businessReader(ctx, rpc, block)
	scalar := func(address, signature, args, typ string) (string, error) {
		v, e := read(address, signature, args, []events.Input{{Name: "value", Type: typ}})
		if e != nil {
			return "", e
		}
		return v["value"].(string), nil
	}
	for _, edge := range []struct{ from, signature, want string }{{roots["TickerGardenFactoryV1"], "treasuryDistributor()", distributor}, {distributor, "marketRegistry()", roots["MarketRegistryV1"]}} {
		v, e := scalar(edge.from, edge.signature, "", "address")
		if e != nil {
			return fail(e)
		}
		if v != edge.want {
			return fail(errors.New("Treasury request core binding mismatch"))
		}
	}
	canonical, e := read(roots["MarketRegistryV1"], "market(bytes32)", marketID[2:], marketFields)
	if e != nil {
		return fail(e)
	}
	market, e := read(distributor, "market(bytes32)", marketID[2:], treasuryMarketFields)
	if e != nil {
		return fail(e)
	}
	if market["memeToken"] != canonical["memeToken"] || market["quoteToken"] != canonical["quoteAsset"] || market["activatedAt"] == "0" || market["eligibilityPolicyHash"] == zero32 {
		return fail(errors.New("Treasury request market identity mismatch"))
	}
	epoch, e := read(distributor, "epoch(bytes32,uint32)", args, treasuryEpochFields)
	if e != nil {
		return fail(e)
	}
	switch epoch["status"] {
	case "0", "1", "2", "3", "4":
	default:
		return fail(errors.New("invalid Treasury epoch status"))
	}
	if mode == "request" && epoch["status"] != "1" {
		return fail(ErrTreasuryRequestInactive)
	}
	if mode == "request" && (epoch["claimedAmount"] != "0" || epoch["requester"] == zero20 || epoch["quoteAmount"] == "0") {
		return fail(errors.New("Treasury epoch is not an unclaimed funded request"))
	}
	if mode == "claim" && epoch["status"] != "3" {
		return fail(ErrTreasuryNotClaiming)
	}
	requested, _ := strconv.ParseUint(epoch["requestedAt"].(string), 10, 64)
	publishBy, _ := strconv.ParseUint(epoch["publishBy"].(string), 10, 64)
	if requested == 0 || requested > now || publishBy <= requested {
		return fail(errors.New("Treasury request publication window invalid or expired"))
	}

	if mode == "request" && now > publishBy {
		return fail(ErrTreasuryRequestExpired)
	}
	if mode == "claim" {
		until, _ := strconv.ParseUint(epoch["claimUntil"].(string), 10, 64)
		after, _ := strconv.ParseUint(epoch["finalizeAfter"].(string), 10, 64)
		if now > until {
			return fail(ErrTreasuryExpired)
		}
		claimed, _ := new(big.Int).SetString(epoch["claimedAmount"].(string), 10)
		amount, _ := new(big.Int).SetString(epoch["quoteAmount"].(string), 10)
		if after < requested || after > now || until <= after || epoch["merkleRoot"] == zero32 || epoch["datasetHash"] == zero32 || epoch["leafCount"] == "0" || epoch["totalTwab"] == "0" || amount.Sign() == 0 || claimed.Cmp(amount) > 0 {
			return fail(errors.New("invalid published Treasury epoch"))
		}
	}
	if mode == "pending" {
		if epoch["status"] != "2" {
			return fail(errors.New("Treasury epoch is not ROOT_PENDING"))
		}
		after, _ := strconv.ParseUint(epoch["finalizeAfter"].(string), 10, 64)
		empty := epoch["totalTwab"] == "0" && epoch["leafCount"] == "0"
		if after < requested || epoch["claimedAmount"] != "0" || epoch["claimUntil"] != "0" || epoch["requester"] == zero20 || epoch["quoteAmount"] == "0" || epoch["datasetHash"] == zero32 {
			return fail(errors.New("invalid pending Treasury epoch"))
		}
		if empty {
			if epoch["merkleRoot"] != Hash([]byte("TICKERGARDEN_V1_TREASURY_EMPTY_EPOCH_V1")) {
				return fail(errors.New("invalid empty Treasury commitment"))
			}
		} else if epoch["merkleRoot"] == zero32 || epoch["totalTwab"] == "0" || epoch["leafCount"] == "0" {
			return fail(errors.New("invalid pending Treasury commitment"))
		}
	}
	funded, e := scalar(distributor, "epochQuoteAmount(bytes32,uint32)", args, "uint256")
	if e != nil {
		return fail(e)
	}
	if funded != epoch["quoteAmount"] {
		return fail(errors.New("Treasury request funding mismatch"))
	}
	window, e := read(distributor, "epochWindow(bytes32,uint32)", args, []events.Input{{Name: "start", Type: "uint64"}, {Name: "end", Type: "uint64"}})
	if e != nil {
		return fail(e)
	}
	duration, e := scalar(distributor, "EPOCH_DURATION()", "", "uint32")
	if e != nil {
		return fail(e)
	}
	schema, e := scalar(distributor, "TWAB_SCHEMA()", "", "bytes32")
	if e != nil {
		return fail(e)
	}
	start, _ := strconv.ParseUint(window["start"].(string), 10, 64)
	end, _ := strconv.ParseUint(window["end"].(string), 10, 64)
	seconds, _ := strconv.ParseUint(duration, 10, 32)
	if seconds == 0 || end <= start || end-start != seconds || end > requested || schema == zero32 {
		return fail(errors.New("Treasury request epoch policy mismatch"))
	}
	sourceNumber, _ := strconv.ParseUint(epoch["sourceBlockNumber"].(string), 10, 64)
	if sourceNumber >= height {
		return fail(errors.New("Treasury request source is not historical"))
	}
	source, e := rpc.Header(ctx, fmt.Sprintf("0x%x", sourceNumber))
	if e != nil {
		return fail(e)
	}
	sourceTime, e := source.Time()
	if e != nil {
		return fail(e)
	}
	if source.Number != fmt.Sprintf("0x%x", sourceNumber) || source.Hash != epoch["sourceBlockHash"] || sourceTime < end || sourceTime > requested {
		return fail(errors.New("Treasury request canonical source mismatch"))
	}
	last, e := rpc.Header(ctx, block.Number)
	if e != nil {
		return fail(e)
	}
	if last.Hash != block.Hash || last.Timestamp != block.Timestamp {
		return fail(errors.New("Treasury request observation changed"))
	}
	return TreasuryRequestSnapshot{ChainID: m.ChainID, BlockHash: block.Hash, BlockNumber: block.Number, Distributor: distributor, MarketID: marketID, EpochID: epochID, Market: market, Epoch: epoch, Window: window, EpochDuration: duration, TwabSchema: schema, SourceTimestamp: strconv.FormatUint(sourceTime, 10)}, nil
}

// TreasuryClaimConsumed checks both contract replay guards at the same block,
// then rechecks canonicality after the final call.
func TreasuryClaimConsumed(ctx context.Context, rpc BindingObserver, block chainrpc.Header, distributor, marketID string, epochID, index uint32, account string) (bool, error) {
	if !hex32.MatchString(marketID) || !hex20.MatchString(distributor) || !hex20.MatchString(account) || epochID == 0 {
		return false, errors.New("invalid claim identity")
	}
	read := businessReader(ctx, rpc, block)
	args := marketID[2:] + fmt.Sprintf("%064x", epochID)
	consumed := false
	for _, call := range []struct{ signature, args string }{
		{"isClaimed(bytes32,uint32,uint256)", args + fmt.Sprintf("%064x", index)},
		{"accountClaimed(bytes32,uint32,address)", args + fmt.Sprintf("%064s", account[2:])},
	} {
		value, err := read(distributor, call.signature, call.args, []events.Input{{Name: "value", Type: "bool"}})
		if err != nil {
			return false, err
		}
		consumed = consumed || value["value"].(bool)
	}
	last, err := rpc.Header(ctx, block.Number)
	if err != nil || last.Hash != block.Hash || last.Timestamp != block.Timestamp {
		return false, errors.New("Treasury claim observation changed")
	}
	return consumed, nil
}
