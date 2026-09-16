// Package principal reconstructs Vault principal from ordered authenticated
// events. It never uses getter values to repair its event-derived balances.
package principal

import (
	"errors"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"tickergarden/backend/internal/events"
)

var hash = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var address = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var decimal = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

type Account struct {
	AssetUID  string `json:"assetUid"`
	User      string `json:"user"`
	Deposited string `json:"deposited"`
	Allocated string `json:"allocated"`
	Free      string `json:"free"`
}
type Allocation struct {
	AssetUID string `json:"assetUid"`
	User     string `json:"user"`
	MarketID string `json:"marketId"`
	Amount   string `json:"amount"`
}
type Ledger struct {
	accounts    map[string]Account
	allocations map[string]Allocation
}

func New() *Ledger {
	return &Ledger{accounts: map[string]Account{}, allocations: map[string]Allocation{}}
}
func integer(v any) (*big.Int, error) {
	s, ok := v.(string)
	if !ok || !decimal.MatchString(s) {
		return nil, errors.New("invalid principal integer")
	}
	n, _ := new(big.Int).SetString(s, 10)
	if n.BitLen() > 256 {
		return nil, errors.New("principal uint256 overflow")
	}
	return n, nil
}
func value(s string) *big.Int { n, _ := new(big.Int).SetString(s, 10); return n }
func validID(s string) bool   { return hash.MatchString(s) && s != "0x"+strings.Repeat("0", 64) }

// Apply requires the caller to authenticate the Vault/asset binding and preserve
// canonical log order and deduplication. Failure leaves the ledger unchanged.
func (l *Ledger) Apply(e events.Decoded) error {
	if e.Module != "UserStockVault" {
		return nil
	}
	name := strings.Split(e.Signature, "(")[0]
	if name != "StockDeposited" && name != "StockWithdrawn" && name != "AllocationLocked" && name != "AllocationReleased" {
		return nil
	} // RageQuit is a notification after release+withdraw.
	asset, _ := e.Args["assetUid"].(string)
	user, _ := e.Args["user"].(string)
	market, _ := e.Args["marketId"].(string)
	if !validID(asset) || !address.MatchString(user) || user == "0x"+strings.Repeat("0", 40) {
		return errors.New("invalid principal account")
	}
	amount, err := integer(e.Args["amount"])
	if err != nil || amount.Sign() <= 0 {
		return errors.New("invalid principal amount")
	}
	key := asset + ":" + user
	a, ok := l.accounts[key]
	if !ok {
		a = Account{AssetUID: asset, User: user, Deposited: "0", Allocated: "0", Free: "0"}
	}
	dep, allocated := value(a.Deposited), value(a.Allocated)
	allocation := Allocation{AssetUID: asset, User: user, MarketID: market, Amount: "0"}
	allocationKey := key + ":" + market
	if old, ok := l.allocations[allocationKey]; ok {
		allocation = old
	}
	balance := value(allocation.Amount)
	switch name {
	case "StockDeposited":
		dep.Add(dep, amount)
	case "StockWithdrawn":
		dep.Sub(dep, amount)
	case "AllocationLocked", "AllocationReleased":
		if !validID(market) {
			return errors.New("invalid principal market")
		}
		if name == "AllocationLocked" {
			balance.Add(balance, amount)
			allocated.Add(allocated, amount)
		} else {
			balance.Sub(balance, amount)
			allocated.Sub(allocated, amount)
		}
		after, e1 := integer(e.Args["userMarketAllocation"])
		total, e2 := integer(e.Args["userTotalAllocated"])
		if e1 != nil || e2 != nil || balance.Sign() < 0 || balance.Cmp(after) != 0 || allocated.Cmp(total) != 0 {
			return errors.New("principal event checkpoint mismatch")
		}
	}
	if dep.Sign() < 0 || allocated.Sign() < 0 || allocated.Cmp(dep) > 0 || dep.BitLen() > 256 || allocated.BitLen() > 256 {
		return errors.New("principal conservation violation")
	}
	a.Deposited = dep.String()
	a.Allocated = allocated.String()
	a.Free = new(big.Int).Sub(dep, allocated).String()
	l.accounts[key] = a
	if name == "AllocationLocked" || name == "AllocationReleased" {
		allocation.Amount = balance.String()
		l.allocations[allocationKey] = allocation
	}
	return nil
}
func (l *Ledger) Accounts() []Account {
	keys := []string{}
	for k := range l.accounts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := []Account{}
	for _, k := range keys {
		out = append(out, l.accounts[k])
	}
	return out
}
func (l *Ledger) Allocations() []Allocation {
	keys := []string{}
	for k := range l.allocations {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := []Allocation{}
	for _, k := range keys {
		out = append(out, l.allocations[k])
	}
	return out
}
