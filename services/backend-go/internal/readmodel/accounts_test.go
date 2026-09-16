package readmodel

import (
	"encoding/json"
	"math/big"
	"os"
	"strings"
	"testing"
)

func accountFixture(t *testing.T) Snapshot {
	t.Helper()
	rawJSON, err := os.ReadFile("testdata/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := Parse(rawJSON, 46630)
	if err != nil {
		t.Fatal(err)
	}
	p := s.Positions[0]
	vault := "0x" + strings.Repeat("9", 40)
	for i := range s.Configs {
		if s.Configs[i].Kind == "asset" && s.Configs[i].ID == p.AssetUID {
			s.Configs[i].Values["userStockVault"] = vault
		}
	}
	free, _ := new(big.Int).SetString(p.Free, 10)
	allocated, _ := new(big.Int).SetString(p.Allocated, 10)
	accounts := []UserAccountReadModel{{User: p.User, AssetUID: p.AssetUID, Vault: vault, Deposited: new(big.Int).Add(free, allocated).String(), Allocated: p.Allocated, Free: p.Free, Source: p.Source}, {User: "0x" + strings.Repeat("8", 40), AssetUID: p.AssetUID, Vault: vault, Deposited: "9", Allocated: "0", Free: "9", Source: p.Source}}
	s.Accounts = &accounts
	return s
}
func TestAccountSnapshotInvariants(t *testing.T) {
	for _, mode := range []string{"valid", "duplicate", "missing", "wrong free", "wrong total", "wrong vault", "wrong source", "overflow"} {
		t.Run(mode, func(t *testing.T) {
			s := accountFixture(t)
			a := s.Accounts
			switch mode {
			case "duplicate":
				*a = append(*a, (*a)[0])
			case "missing":
				*a = (*a)[1:]
			case "wrong free":
				(*a)[0].Free = "1"
			case "wrong total":
				(*a)[0].Allocated = "1"
			case "wrong vault":
				(*a)[0].Vault = "0x" + strings.Repeat("7", 40)
			case "wrong source":
				(*a)[0].Source.BlockNumber = "999999999"
			case "overflow":
				(*a)[0].Deposited = new(big.Int).Lsh(big.NewInt(1), 256).String()
			}
			data, err := json.Marshal(s)
			if err != nil {
				t.Fatal(err)
			}
			_, err = Parse(data, 46630)
			if (err == nil) != (mode == "valid") {
				t.Fatal(mode, err)
			}
		})
	}
}
