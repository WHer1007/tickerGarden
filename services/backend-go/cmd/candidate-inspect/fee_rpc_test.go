package main

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

type nativeFeeObserver struct {
	gaugeObserver
	balance string
}

func (f nativeFeeObserver) BalanceAt(_ context.Context, a, h string) (string, error) {
	if a != "0x"+strings.Repeat("4", 40) || h != f.hash {
		return "", fmt.Errorf("scope")
	}
	return f.balance, nil
}

func TestCandidateFeeCoverageRPC(t *testing.T) {
	for _, mode := range []string{"valid", "surplus", "total mismatch", "underfunded", "missing market", "duplicate market", "bad ABI", "RPC error", "native", "native underfunded", "native noncanonical", "claimable exact", "claimable surplus", "quote over bucket", "meme over bucket", "duplicate position", "unknown position market", "wrong claim asset", "wrong claim kind", "missing claim", "noncanonical claim", "negative claim", "claim overflow", "claim sum overflow", "empty markets with position"} {
		t.Run(mode, func(t *testing.T) {
			h := "0x" + strings.Repeat("1", 64)
			quote := "0x" + strings.Repeat("2", 40)
			meme := "0x" + strings.Repeat("3", 40)
			vault := "0x" + strings.Repeat("4", 40)
			native := strings.HasPrefix(mode, "native")
			if native {
				quote = "0x" + strings.Repeat("0", 40)
			}
			calls := map[string][]byte{}
			put := func(a, sig, args string, n *big.Int) {
				calls[a+deployment.Hash([]byte(sig))[:10]+args] = n.FillBytes(make([]byte, 32))
			}
			// Above JavaScript's exact integer range; shared quote asset across two markets.
			unit, _ := new(big.Int).SetString("900719925474099312345", 10)
			c := readmodel.CandidateSet{BlockHash: h}
			for _, digit := range []string{"5", "6"} {
				id := "0x" + strings.Repeat(digit, 64)
				c.Markets = append(c.Markets, readmodel.MarketReadModel{MarketID: id, QuoteAsset: quote, MemeToken: meme})
				for _, asset := range []string{quote, meme} {
					args := id[2:] + strings.Repeat("0", 24) + asset[2:]
					for bucket := 0; bucket < 4; bucket++ {
						put(vault, "liability(bytes32,address,uint8)", args+fmt.Sprintf("%064x", bucket), unit)
					}
					put(vault, "forfeitureReserve(bytes32,address)", args, unit)
				}
			}
			if strings.Contains(mode, "claim") || strings.Contains(mode, "position") || strings.Contains(mode, "over bucket") {
				for _, digit := range []string{"7", "8"} {
					c.Positions = append(c.Positions, readmodel.UserPositionReadModel{User: "0x" + strings.Repeat(digit, 40), MarketID: c.Markets[0].MarketID, Claimable: []readmodel.Claimable{{Kind: "quote", Asset: quote, Amount: new(big.Int).Div(new(big.Int).Set(unit), big.NewInt(2)).String()}, {Kind: "meme", Asset: meme, Amount: "0"}}})
				}
				// Odd bucket amount: two floor halves leave one unit of dust.
				if mode == "claimable exact" {
					c.Positions[0].Claimable[0].Amount = new(big.Int).Add(new(big.Int).Div(new(big.Int).Set(unit), big.NewInt(2)), big.NewInt(1)).String()
				}
				switch mode {
				case "quote over bucket":
					c.Positions[0].Claimable[0].Amount = unit.String()
				case "meme over bucket":
					c.Positions[0].Claimable[1].Amount = new(big.Int).Add(unit, big.NewInt(1)).String()
				case "duplicate position":
					c.Positions[1].User = c.Positions[0].User
				case "unknown position market":
					c.Positions[0].MarketID = "0x" + strings.Repeat("9", 64)
				case "wrong claim asset":
					c.Positions[0].Claimable[0].Asset = meme
				case "wrong claim kind":
					c.Positions[0].Claimable[0].Kind = "creator"
				case "missing claim":
					c.Positions[0].Claimable = c.Positions[0].Claimable[:1]
				case "noncanonical claim":
					c.Positions[0].Claimable[0].Amount = "01"
				case "negative claim":
					c.Positions[0].Claimable[0].Amount = "-1"
				case "claim sum overflow":
					c.Positions[0].Claimable[0].Amount = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)).String()
				case "claim overflow":
					c.Positions[0].Claimable[0].Amount = new(big.Int).Lsh(big.NewInt(1), 256).String()
				case "empty markets with position":
					c.Markets = nil
				}
			}
			total := new(big.Int).Mul(unit, big.NewInt(10))
			bal := new(big.Int).Set(total)
			if mode == "surplus" {
				bal.Add(bal, big.NewInt(1))
			}
			if mode == "underfunded" || mode == "native underfunded" {
				bal.Sub(bal, big.NewInt(1))
			}
			for _, asset := range []string{quote, meme} {
				put(vault, "totalLiability(address)", strings.Repeat("0", 24)+asset[2:], total)
				put(asset, "balanceOf(address)", strings.Repeat("0", 24)+vault[2:], bal)
			}
			key := vault + deployment.Hash([]byte("totalLiability(address)"))[:10] + strings.Repeat("0", 24) + quote[2:]
			if mode == "total mismatch" {
				put(vault, "totalLiability(address)", strings.Repeat("0", 24)+quote[2:], new(big.Int).Add(total, big.NewInt(1)))
			}
			if mode == "bad ABI" {
				calls[key] = []byte{1}
			}
			if mode == "RPC error" {
				delete(calls, key)
			}
			if mode == "missing market" {
				c.Markets = c.Markets[:1]
			}
			if mode == "duplicate market" {
				c.Markets = append(c.Markets, c.Markets[0])
			}
			m := deployment.Manifest{Contracts: []deployment.Contract{{Module: "ProtocolFeeVault", Address: vault}}}
			f := gaugeObserver{hash: h, calls: calls}
			var observer deployment.BindingObserver = f
			if native {
				raw := bal.String()
				if mode == "native noncanonical" {
					raw = "0" + raw
				}
				observer = nativeFeeObserver{gaugeObserver: f, balance: raw}
			}
			valid := mode == "valid" || mode == "surplus" || mode == "native" || mode == "claimable exact" || mode == "claimable surplus"
			if e := verifyCandidateFeeCoverage(context.Background(), observer, m, c); (e == nil) != valid {
				t.Fatal(mode, e)
			}
			if !native {
				client, count := stateHTTPFixture(t, h, f)
				if e := verifyCandidateFeeCoverage(context.Background(), client, m, c); (e == nil) != valid {
					t.Fatal("HTTP", mode, e)
				}
				if valid && count.Load() != 24 {
					t.Fatal("read count", count.Load())
				}
			}
		})
	}
}
