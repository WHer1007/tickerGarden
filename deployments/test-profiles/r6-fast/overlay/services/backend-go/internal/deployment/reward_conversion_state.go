package deployment

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
	"time"
)

type ConversionParticipant struct {
	User         string `json:"user"`
	CreatorEpoch uint32 `json:"creatorEpoch"`
}
type ConversionParticipantState struct {
	ConversionParticipant
	AvailableMeme string `json:"availableMeme"`
	RawExitAt     string `json:"rawExitAt"`
	Eligible      bool   `json:"eligible"`
	Reason        string `json:"reason,omitempty"`
}
type RewardConversionState struct {
	ChainID      uint64                       `json:"chainId"`
	GenesisHash  string                       `json:"genesisHash"`
	Block        chainrpc.Header              `json:"block"`
	MarketID     string                       `json:"marketId"`
	FeeVault     string                       `json:"feeVault"`
	Operator     string                       `json:"operator"`
	MemeToken    string                       `json:"memeToken"`
	QuoteAsset   string                       `json:"quoteAsset"`
	Participants []ConversionParticipantState `json:"participants"`
}

// ObserveRewardConversionState reads eligibility and available rewards at one
// recent authenticated block. It does not attest price, liquidity or solvency.
func ObserveRewardConversionState(ctx context.Context, rpc BindingObserver, m Manifest, block chainrpc.Header, operator, marketID string, participants []ConversionParticipant) (RewardConversionState, error) {
	fail := func() (RewardConversionState, error) {
		return RewardConversionState{}, errors.New("reward conversion state unavailable or inconsistent")
	}
	stamp, e := block.Time()
	now := time.Now().Unix()
	if rpc == nil || e != nil || stamp > uint64(now+5) || now-int64(stamp) > 120 || !hex20.MatchString(operator) || operator == zero20 || !hex32.MatchString(marketID) || marketID == zero32 || len(participants) == 0 || len(participants) > 32 {
		return fail()
	}
	seen := map[ConversionParticipant]bool{}
	for _, p := range participants {
		if !hex20.MatchString(p.User) || p.User == zero20 || seen[p] {
			return fail()
		}
		seen[p] = true
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if _, e = VerifyCoreBindings(ctx, rpc, m, block); e != nil {
		return fail()
	}
	roots := map[string]string{}
	for _, c := range m.Contracts {
		if c.Module != "ProtocolFeeVault" && c.Module != "MarketRegistryV1" && c.Module != "CreatorRevenueRegistry" && c.Module != "TickerGardenFactoryV1" && c.Module != "AllocationManager" {
			continue
		}
		if _, exists := roots[c.Module]; exists {
			return fail()
		}
		roots[c.Module] = c.Address
	}
	manifested := func(module, address string) bool {
		for _, c := range m.Contracts {
			if c.Module == module && c.Address == address {
				return true
			}
		}
		return false
	}
	read := businessReader(ctx, rpc, block)
	scalar := func(target, signature, args, typ string) (string, error) {
		v, e := read(target, signature, args, []events.Input{{Name: "value", Type: typ}})
		if e != nil {
			return "", e
		}
		return v["value"].(string), nil
	}
	vault := roots["ProtocolFeeVault"]
	registry := roots["MarketRegistryV1"]
	creator := roots["CreatorRevenueRegistry"]
	if creator == "" || creator == zero20 {
		return fail()
	}
	for _, edge := range []struct{ target, signature, want string }{
		{vault, "marketRegistry()", registry}, {vault, "creatorRevenueRegistry()", creator},
		{creator, "marketRegistry()", registry}, {creator, "factory()", roots["TickerGardenFactoryV1"]},
		{vault, "settlementOperator()", operator},
	} {
		got, e := scalar(edge.target, edge.signature, "", "address")
		if e != nil || got != edge.want {
			return fail()
		}
	}
	market, e := read(registry, "market(bytes32)", marketID[2:], marketFields)
	if e != nil || validateMarketState(market) != nil || market["launchPhase"] != "1" {
		return fail()
	}
	token := market["memeToken"].(string)
	quote := market["quoteAsset"].(string)
	if got, e := scalar(registry, "marketIdByToken(address)", addressArgument(token), "bytes32"); e != nil || got != marketID {
		return fail()
	}
	if got, e := scalar(vault, "feePolicyId()", "", "bytes32"); e != nil || got != market["feePolicyId"] {
		return fail()
	}
	if !manifested("TickerMemeTokenV1", token) {
		return fail()
	}
	for _, edge := range []struct{ signature, typ, want string }{{"marketId()", "bytes32", marketID}, {"factory()", "address", roots["TickerGardenFactoryV1"]}} {
		got, e := scalar(token, edge.signature, "", edge.typ)
		if e != nil || got != edge.want {
			return fail()
		}
	}
	gauge := market["gauge"].(string)
	enabled := market["stakingEnabled"] == true
	if enabled {
		if !manifested("MemeStockGauge", gauge) {
			return fail()
		}
		identity, e := read(gauge, "gaugeIdentity()", "", gaugeIdentityFields)
		if e != nil {
			return fail()
		}
		expected := map[string]any{"marketId": marketID, "assetUid": market["assetUid"], "quoteAssetConfigId": market["quoteAssetConfigId"], "allocationManager": roots["AllocationManager"], "protocolFeeVault": vault, "quoteAsset": quote, "memeToken": token}
		for _, field := range gaugeIdentityFields {
			if identity[field.Name] != expected[field.Name] {
				return fail()
			}
		}
	}
	out := RewardConversionState{ChainID: m.ChainID, GenesisHash: m.GenesisHash, Block: block, MarketID: marketID, FeeVault: vault, Operator: operator, MemeToken: token, QuoteAsset: quote, Participants: []ConversionParticipantState{}}
	for _, p := range participants {
		row := ConversionParticipantState{ConversionParticipant: p, AvailableMeme: "0", Eligible: true}
		row.RawExitAt, e = scalar(vault, "rawRewardExitAt(bytes32,address)", marketID[2:]+addressArgument(p.User), "uint256")
		if e != nil {
			return fail()
		}
		if p.CreatorEpoch != 0 {
			args := marketID[2:] + fmt.Sprintf("%064x", p.CreatorEpoch)
			beneficiary, e := scalar(creator, "creatorBeneficiaryAt(bytes32,uint32)", args, "address")
			if e != nil || beneficiary != p.User {
				return fail()
			}
			row.AvailableMeme, e = scalar(vault, "creatorLiability(bytes32,uint32,address)", args+addressArgument(token), "uint256")
			if e != nil {
				return fail()
			}
		} else if !enabled {
			row.Eligible = false
			row.Reason = "staking_disabled"
		} else {
			position, e := read(gauge, "positionOf(address)", addressArgument(p.User), gaugePositionFields)
			if e != nil {
				return fail()
			}
			row.AvailableMeme = position["memeClaimable"].(string)
			pending, e := read(roots["AllocationManager"], "rageQuitSettlementPending(bytes32,address)", marketID[2:]+addressArgument(p.User), []events.Input{{Name: "pending", Type: "bool"}, {Name: "principal", Type: "uint256"}})
			if e != nil {
				return fail()
			}
			if pending["pending"] == true || pending["principal"] != "0" {
				row.Eligible = false
				row.Reason = "rage_quit_pending"
			}
		}
		exit, _ := new(big.Int).SetString(row.RawExitAt, 10)
		if exit.Sign() > 0 && exit.Cmp(new(big.Int).SetUint64(stamp)) <= 0 {
			row.Eligible = false
			row.Reason = "raw_exit_matured"
		}
		if row.AvailableMeme == "0" && row.Eligible {
			row.Eligible = false
			row.Reason = "no_rewards"
		}
		out.Participants = append(out.Participants, row)
	}
	last, e := rpc.Header(ctx, block.Number)
	if e != nil || last != block || time.Now().Unix()-int64(stamp) > 120 {
		return fail()
	}
	return out, nil
}
