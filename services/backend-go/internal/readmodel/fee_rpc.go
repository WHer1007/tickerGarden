package readmodel

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
)

// VerifyFeeCoverageRPC checks aggregate coverage for assets in the candidate market inventory.
// It does not prove epoch entitlement, market inventory completeness, or settlement.
func VerifyFeeCoverageRPC(ctx context.Context, rpc deployment.BindingObserver, m deployment.Manifest, c CandidateSet) error {
	return verifyFeeCoverageWithCheck(ctx, rpc, m, c, nil)
}

func verifyFeeCoverageWithCheck(ctx context.Context, rpc deployment.BindingObserver, m deployment.Manifest, c CandidateSet, check func(string, string, string, *big.Int) error) error {
	bad := errors.New("candidate FeeVault coverage RPC mismatch")
	compare := func(kind, key, field string, value *big.Int) error {
		if check == nil {
			return nil
		}
		return check(kind, key, field, value)
	}
	if len(c.Markets) > 1000 || len(c.Positions) > 10000 || (len(c.Markets) == 0 && len(c.Positions) != 0) {
		return bad
	}
	if len(c.Markets) == 0 {
		return nil
	}
	vault := ""
	for _, contract := range m.Contracts {
		if contract.Module == "ProtocolFeeVault" {
			if vault != "" {
				return bad
			}
			vault = contract.Address
		}
	}
	validHex := func(s string, size int) bool {
		if len(s) != 2+size*2 || !strings.HasPrefix(s, "0x") {
			return false
		}
		_, e := hex.DecodeString(s[2:])
		return e == nil && strings.ToLower(s) == s
	}
	zero := "0x" + strings.Repeat("0", 40)
	if !validHex(vault, 20) || vault == zero {
		return bad
	}
	amount := func(address, signature, args string) (*big.Int, error) {
		raw, e := rpc.CallAt(ctx, address, deployment.Hash([]byte(signature))[:10]+args, c.BlockHash)
		if e != nil {
			return nil, bad
		}
		values, e := events.DecodeStatic([]events.Input{{Name: "amount", Type: "uint256"}}, raw)
		if e != nil {
			return nil, bad
		}
		n, ok := new(big.Int).SetString(values["amount"].(string), 10)
		if !ok {
			return nil, bad
		}
		return n, nil
	}
	// Claimable rewards are a lower bound, not an equality: accumulator dust
	// and deferred forfeiture can remain in the Staker bucket. Gauge RPC checks
	// authenticate each position before this cross-contract coverage check.
	markets := map[string]MarketReadModel{}
	for _, market := range c.Markets {
		markets[market.MarketID] = market
	}
	claims := map[string][2]*big.Int{}
	positions := map[string]bool{}
	for _, position := range c.Positions {
		market, ok := markets[position.MarketID]
		key := position.MarketID + ":" + position.User
		if !ok || positions[key] || !validHex(position.User, 20) || position.User == zero || len(position.Claimable) != 2 {
			return bad
		}
		positions[key] = true
		total, ok := claims[position.MarketID]
		if !ok {
			total = [2]*big.Int{new(big.Int), new(big.Int)}
		}
		for i, claim := range position.Claimable {
			if claim.Kind != [2]string{"quote", "meme"}[i] || claim.Asset != [2]string{market.QuoteAsset, market.MemeToken}[i] || len(claim.Amount) > 78 {
				return bad
			}
			n, ok := new(big.Int).SetString(claim.Amount, 10)
			if !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != claim.Amount {
				return bad
			}
			total[i].Add(total[i], n)
			if total[i].BitLen() > 256 {
				return bad
			}
		}
		claims[position.MarketID] = total
	}
	sums := map[string]*big.Int{}
	seen := map[string]bool{}
	for _, market := range c.Markets {
		if !validHex(market.MarketID, 32) || seen[market.MarketID] || !validHex(market.QuoteAsset, 20) || !validHex(market.MemeToken, 20) || market.MemeToken == zero || market.QuoteAsset == market.MemeToken {
			return bad
		}
		seen[market.MarketID] = true
		for assetIndex, asset := range []string{market.QuoteAsset, market.MemeToken} {
			subtotal := new(big.Int)
			if sums[asset] == nil {
				sums[asset] = new(big.Int)
			}
			args := market.MarketID[2:] + strings.Repeat("0", 24) + asset[2:]
			for bucket := 0; bucket < 4; bucket++ {
				n, e := amount(vault, "liability(bytes32,address,uint8)", args+fmt.Sprintf("%064x", bucket))
				if e != nil {
					return bad
				}
				if total, ok := claims[market.MarketID]; bucket == 1 && ok && total[assetIndex].Cmp(n) > 0 {
					return bad
				}
				if compare("feeLiability", market.MarketID+":"+asset, []string{"creator", "staker", "platform", "holder"}[bucket], n) != nil {
					return bad
				}
				sums[asset].Add(sums[asset], n)
				subtotal.Add(subtotal, n)
			}
			reserve, e := amount(vault, "forfeitureReserve(bytes32,address)", args)
			if e != nil {
				return bad
			}
			subtotal.Add(subtotal, reserve)
			if compare("feeLiability", market.MarketID+":"+asset, "forfeitureReserve", reserve) != nil || compare("feeLiability", market.MarketID+":"+asset, "bucketAndReserveTotal", subtotal) != nil {
				return bad
			}
			sums[asset].Add(sums[asset], reserve)
			if sums[asset].BitLen() > 256 {
				return bad
			}
		}
	}
	for asset, sum := range sums {
		total, e := amount(vault, "totalLiability(address)", strings.Repeat("0", 24)+asset[2:])
		if e != nil || total.Cmp(sum) != 0 {
			return bad
		}
		if compare("feeSolvency", asset, "totalLiability", total) != nil || compare("feeSolvency", asset, "knownMarketLiabilitySum", sum) != nil {
			return bad
		}
		var balance *big.Int
		if asset == zero {
			native, ok := rpc.(interface {
				BalanceAt(context.Context, string, string) (string, error)
			})
			if !ok {
				return bad
			}
			raw, e := native.BalanceAt(ctx, vault, c.BlockHash)
			n, ok := new(big.Int).SetString(raw, 10)
			if e != nil || !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != raw {
				return bad
			}
			balance = n
		} else {
			balance, e = amount(asset, "balanceOf(address)", strings.Repeat("0", 24)+vault[2:])
			if e != nil {
				return bad
			}
		}
		if balance.Cmp(total) < 0 || compare("feeSolvency", asset, "balance", balance) != nil {
			return bad
		}
	}
	return nil
}
