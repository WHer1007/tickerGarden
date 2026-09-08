package deployment

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

type feeFixture struct {
	*discoveryFixture
	balances     map[string]string
	balanceErr   bool
	balanceReads int
}

func (f *feeFixture) BalanceAt(_ context.Context, address, hash string) (string, error) {
	f.balanceReads++
	if hash != blockHash || f.balanceErr {
		return "", errors.New("unavailable")
	}
	return f.balances[address], nil
}
func feeSetup(t *testing.T, native bool) (*feeFixture, chainrpc.Header, map[string]MarketDiscovery, string, string) {
	t.Helper()
	base, b, id := discoverySetup(t, false, false)
	b.Timestamp = "0x64"
	found, err := DiscoverBlock(context.Background(), base, base.manifest, b)
	if err != nil {
		t.Fatal(err)
	}
	market := found[0]
	if native {
		market.State["quoteAsset"] = zero20
	}
	f := &feeFixture{discoveryFixture: base, balances: map[string]string{}}
	roots := map[string]string{}
	for _, c := range f.manifest.Contracts {
		roots[c.Module] = c.Address
	}
	vault := roots["ProtocolFeeVault"]
	creator := "0x" + strings.Repeat("6", 40)
	f.code[creator] = []byte{6}
	f.calls[vault+Hash([]byte("marketRegistry()"))[:10]] = addrWord(roots["MarketRegistryV1"])
	f.calls[vault+Hash([]byte("creatorRevenueRegistry()"))[:10]] = addrWord(creator)
	f.calls[vault+Hash([]byte("feePolicyId()"))[:10]] = bytesWord(market.State["feePolicyId"].(string))
	f.calls[creator+Hash([]byte("factory()"))[:10]] = addrWord(roots["TickerGardenFactoryV1"])
	f.calls[creator+Hash([]byte("marketRegistry()"))[:10]] = addrWord(roots["MarketRegistryV1"])
	f.calls[creator+Hash([]byte("currentCreatorEpoch(bytes32)"))[:10]+id[2:]] = bytesWord("2")
	for epoch := 1; epoch <= 2; epoch++ {
		beneficiary := market.State["creatorRevenueBeneficiaryAtCreation"].(string)
		if epoch == 2 {
			beneficiary = "0x" + strings.Repeat("7", 40)
		}
		f.calls[vault+Hash([]byte("rawRewardExitAt(bytes32,address)"))[:10]+id[2:]+addressArgument(beneficiary)] = bytesWord("0")
		f.calls[creator+Hash([]byte("creatorBeneficiaryAt(bytes32,uint32)"))[:10]+id[2:]+fmt.Sprintf("%064x", epoch)] = addrWord(beneficiary)
	}
	for _, asset := range []string{market.State["quoteAsset"].(string), market.State["memeToken"].(string)} {
		for bucket, value := range []string{"3", "4", "5", "6"} {
			f.calls[vault+Hash([]byte("liability(bytes32,address,uint8)"))[:10]+id[2:]+addressArgument(asset)+fmt.Sprintf("%064x", bucket)] = bytesWord(value)
		}
		for epoch := 1; epoch <= 2; epoch++ {
			f.calls[vault+Hash([]byte("creatorLiability(bytes32,uint32,address)"))[:10]+id[2:]+fmt.Sprintf("%064x", epoch)+addressArgument(asset)] = bytesWord(fmt.Sprintf("%x", epoch))
		}
		f.calls[vault+Hash([]byte("forfeitureReserve(bytes32,address)"))[:10]+id[2:]+addressArgument(asset)] = bytesWord("7")
		f.calls[vault+Hash([]byte("totalLiability(address)"))[:10]+addressArgument(asset)] = bytesWord("19") // 3+4+5+6+7 = 25
		if asset == zero20 {
			f.balances[vault] = "25"
		} else {
			f.calls[asset+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(vault)] = bytesWord("19")
		}
	}
	f.headers = 0
	return f, b, map[string]MarketDiscovery{id: market}, vault, creator
}
func TestFeeBucketsReserveAndEpochs(t *testing.T) {
	for _, native := range []bool{true, false} {
		f, b, markets, _, _ := feeSetup(t, native)
		batch, err := ObserveFeeBlock(context.Background(), f, f.manifest, b, markets)
		if err != nil || batch.Expected != 6 || len(batch.Observations) != 6 {
			t.Fatal(batch, err)
		}
		for _, row := range batch.Observations {
			if checks, ok := row.Value["checks"].(map[string]bool); ok {
				for name, passed := range checks {
					if !passed {
						t.Fatal(name, row)
					}
				}
			}
			if row.Kind == "feeLiability" && row.Value["bucketAndReserveTotal"] != "25" {
				t.Fatal("reserve counted incorrectly")
			}
			if row.Kind == "feeSolvency" && row.Value["fullReconciliation"] != false {
				t.Fatal("overclaimed coverage")
			}
		}
		if native && f.balanceReads != 1 {
			t.Fatal("native balance not read once")
		}
	}
}
func TestFeeFailedChecksPersist(t *testing.T) {
	f, b, markets, vault, _ := feeSetup(t, true)
	var id string
	for key := range markets {
		id = key
	}
	f.balances[vault] = "24"
	f.calls[vault+Hash([]byte("creatorLiability(bytes32,uint32,address)"))[:10]+id[2:]+fmt.Sprintf("%064x", 2)+addressArgument(zero20)] = bytesWord("0")
	batch, err := ObserveFeeBlock(context.Background(), f, f.manifest, b, markets)
	if err != nil {
		t.Fatal(err)
	}
	badCreator, badSolvency := false, false
	for _, row := range batch.Observations {
		if row.Key == id+":"+zero20 {
			badCreator = !row.Value["checks"].(map[string]bool)["creatorEpochSumEqualsBucket"]
		}
		if row.Kind == "feeSolvency" && row.Key == zero20 {
			badSolvency = !row.Value["checks"].(map[string]bool)["balanceCoversLiability"]
		}
	}
	if !badCreator || !badSolvency {
		t.Fatal("failed checks disappeared")
	}
}
func TestFeeObservationRejectsInvalidInputs(t *testing.T) {
	for _, name := range []string{"registry", "creator binding", "creator code", "policy", "epoch zero", "epoch budget", "missing beneficiary", "first beneficiary", "native failure", "native malformed", "late ERC20 failure", "reorg"} {
		t.Run(name, func(t *testing.T) {
			f, b, markets, vault, creator := feeSetup(t, true)
			var id string
			for key := range markets {
				id = key
			}
			switch name {
			case "registry":
				f.calls[vault+Hash([]byte("marketRegistry()"))[:10]] = addrWord(zero20)
			case "creator binding":
				f.calls[creator+Hash([]byte("factory()"))[:10]] = addrWord(zero20)
			case "creator code":
				f.code[creator] = nil
			case "policy":
				f.calls[vault+Hash([]byte("feePolicyId()"))[:10]] = bytesWord(zero32)
			case "epoch zero":
				f.calls[creator+Hash([]byte("currentCreatorEpoch(bytes32)"))[:10]+id[2:]] = bytesWord("0")
			case "epoch budget":
				f.calls[creator+Hash([]byte("currentCreatorEpoch(bytes32)"))[:10]+id[2:]] = bytesWord("ffffffff")
			case "missing beneficiary":
				f.calls[creator+Hash([]byte("creatorBeneficiaryAt(bytes32,uint32)"))[:10]+id[2:]+fmt.Sprintf("%064x", 2)] = addrWord(zero20)
			case "first beneficiary":
				f.calls[creator+Hash([]byte("creatorBeneficiaryAt(bytes32,uint32)"))[:10]+id[2:]+fmt.Sprintf("%064x", 1)] = addrWord(creator)
			case "native failure":
				f.balanceErr = true
			case "native malformed":
				f.balances[vault] = "01"
			case "late ERC20 failure":
				delete(f.calls, markets[id].State["memeToken"].(string)+Hash([]byte("balanceOf(address)"))[:10]+addressArgument(vault))
			case "reorg":
				f.finalReorg = true
			}
			batch, err := ObserveFeeBlock(context.Background(), f, f.manifest, b, markets)
			if err == nil || batch.Scope != "" || len(batch.Observations) > 0 {
				t.Fatal(name, batch, err)
			}
		})
	}
}
