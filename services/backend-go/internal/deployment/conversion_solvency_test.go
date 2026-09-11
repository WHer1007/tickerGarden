package deployment

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type conversionSolvencyFixture struct {
	*rewardHeaderFixture
	balances map[string]string
	err      error
}

func (f *conversionSolvencyFixture) BalanceAt(_ context.Context, address, hash string) (string, error) {
	if f.err != nil || hash != blockHash {
		return "", errors.New("balance unavailable")
	}
	return f.balances[address], nil
}

func solvencySetup(t *testing.T, native bool) (*conversionSolvencyFixture, string, map[string]string) {
	t.Helper()
	f, id, roots := conversionSetup(t, true)
	fixture := &conversionSolvencyFixture{rewardHeaderFixture: f, balances: map[string]string{}}
	vault, meme, quote := roots["ProtocolFeeVault"], roots["TickerMemeTokenV1"], "0x"+strings.Repeat("d", 40)
	if native {
		copy(f.calls[roots["MarketRegistryV1"]+Hash([]byte("market(bytes32)"))[:10]+id[2:]][12*32:13*32], make([]byte, 32))
		fixture.balances[vault] = "25"
		quote = zero20
		f.calls[vault+Hash([]byte("totalLiability(address)"))[:10]+addressArgument(zero20)] = bytesWord("14")
	} else {
		f.calls[quote+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(vault)] = bytesWord("19")
	}
	for _, asset := range []string{meme, quote} {
		f.calls[vault+Hash([]byte("totalLiability(address)"))[:10]+addressArgument(asset)] = bytesWord("14")
		if asset == meme {
			f.calls[asset+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(vault)] = bytesWord("14")
		}
	}
	return fixture, id, roots
}

func TestObserveConversionCoverageExactAndSurplus(t *testing.T) {
	for _, native := range []bool{false, true} {
		t.Run(map[bool]string{false: "erc20", true: "native"}[native], func(t *testing.T) {
			f, id, roots := solvencySetup(t, native)
			rows, err := ObserveConversionCoverage(context.Background(), f, f.manifest, f.block, id)
			if err != nil || len(rows) != 2 || rows[0].Surplus != "0" || rows[1].Surplus != "5" || rows[0].Balance != "20" || rows[1].Balance != "25" || rows[0].TotalLiability != "20" || rows[1].TotalLiability != "20" {
				t.Fatalf("rows=%+v err=%v roots=%v", rows, err, roots)
			}
		})
	}
}

func TestObserveConversionCoverageRejectsWithoutPartialOutput(t *testing.T) {
	for _, kind := range []string{"underfunded meme", "underfunded quote", "malformed ABI", "malformed native balance", "reorg", "missing token manifest"} {
		t.Run(kind, func(t *testing.T) {
			native := kind == "malformed native balance"
			f, id, roots := solvencySetup(t, native)
			vault, meme, quote := roots["ProtocolFeeVault"], roots["TickerMemeTokenV1"], "0x"+strings.Repeat("d", 40)
			switch kind {
			case "underfunded meme":
				f.calls[meme+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(vault)] = bytesWord("13")
			case "underfunded quote":
				if native {
					f.balances[vault] = "19"
				} else {
					f.calls[quote+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(vault)] = bytesWord("13")
				}
			case "malformed ABI":
				f.calls[vault+Hash([]byte("totalLiability(address)"))[:10]+addressArgument(meme)] = []byte{1}
			case "malformed native balance":
				f.balances[vault] = "not-a-number"
			case "reorg":
				f.finalReorg = true
			case "missing token manifest":
				for i, c := range f.manifest.Contracts {
					if c.Module == "TickerMemeTokenV1" {
						f.manifest.Contracts = append(f.manifest.Contracts[:i], f.manifest.Contracts[i+1:]...)
						break
					}
				}
			}
			rows, err := ObserveConversionCoverage(context.Background(), f, f.manifest, f.block, id)
			if err == nil || rows != nil {
				t.Fatalf("accepted %s: rows=%+v err=%v", kind, rows, err)
			}
		})
	}
}

func TestNativeCoverageRejectsMalformedQuantitiesAndRPCFailure(t *testing.T) {
	for _, value := range []string{"19", "-1", "025", "0x19", strings.Repeat("9", 79)} {
		f, id, r := solvencySetup(t, true)
		f.balances[r["ProtocolFeeVault"]] = value
		if rows, e := ObserveConversionCoverage(context.Background(), f, f.manifest, f.block, id); e == nil || rows != nil {
			t.Fatal("accepted invalid native balance", value)
		}
	}
	f, id, _ := solvencySetup(t, true)
	f.err = errors.New("fixture RPC failure")
	if rows, e := ObserveConversionCoverage(context.Background(), f, f.manifest, f.block, id); e == nil || rows != nil {
		t.Fatal("accepted failed native balance")
	}
}
