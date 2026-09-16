package principal

import (
	"math/big"
	"sort"
)

// AssetTotal sums each event-ledger account exactly once, never per market.
// Totals use unbounded integers so an aggregate exceeding uint256 stays visible.
type AssetTotal struct {
	AssetUID  string `json:"assetUid"`
	Deposited string `json:"deposited"`
	Allocated string `json:"allocated"`
	Free      string `json:"free"`
	Accounts  int    `json:"accounts"`
}

func (l *Ledger) AssetTotals() []AssetTotal {
	type sum struct {
		deposited, allocated, free *big.Int
		accounts                   int
	}
	totals := map[string]*sum{}
	for _, a := range l.accounts {
		t := totals[a.AssetUID]
		if t == nil {
			t = &sum{new(big.Int), new(big.Int), new(big.Int), 0}
			totals[a.AssetUID] = t
		}
		t.deposited.Add(t.deposited, value(a.Deposited))
		t.allocated.Add(t.allocated, value(a.Allocated))
		t.free.Add(t.free, value(a.Free))
		t.accounts++
	}
	ids := make([]string, 0, len(totals))
	for id := range totals {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]AssetTotal, 0, len(ids))
	for _, id := range ids {
		t := totals[id]
		out = append(out, AssetTotal{id, t.deposited.String(), t.allocated.String(), t.free.String(), t.accounts})
	}
	return out
}

// MarketTotal is a per-asset sum of user allocations, not additional principal.
type MarketTotal struct {
	AssetUID  string `json:"assetUid"`
	MarketID  string `json:"marketId"`
	Allocated string `json:"allocated"`
	Accounts  int    `json:"accounts"`
}

func (l *Ledger) MarketTotals() []MarketTotal {
	amounts := map[string]*big.Int{}
	totals := map[string]MarketTotal{}
	for _, a := range l.allocations {
		key := a.AssetUID + ":" + a.MarketID
		if amounts[key] == nil {
			amounts[key] = new(big.Int)
			totals[key] = MarketTotal{AssetUID: a.AssetUID, MarketID: a.MarketID}
		}
		amounts[key].Add(amounts[key], value(a.Amount))
		t := totals[key]
		t.Accounts++
		totals[key] = t
	}
	keys := make([]string, 0, len(totals))
	for k := range totals {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]MarketTotal, 0, len(keys))
	for _, k := range keys {
		t := totals[k]
		t.Allocated = amounts[k].String()
		out = append(out, t)
	}
	return out
}
