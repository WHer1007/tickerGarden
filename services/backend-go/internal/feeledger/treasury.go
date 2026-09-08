package feeledger

import (
	"math/big"
	"sort"
	"strconv"
	"strings"

	"tickergarden/backend/internal/events"
)

type TreasuryEpoch struct{ MarketID, Epoch, Quote, Distributor string }

// TreasuryBalance.Funded mirrors the current epochQuoteAmount getter, not
// lifetime inflows: rollover clears it while Claimed retains paid history.
type TreasuryBalance struct {
	MarketID    string `json:"marketId"`
	Epoch       string `json:"epoch"`
	QuoteAsset  string `json:"quoteAsset"`
	Distributor string `json:"distributor"`
	Funded      string `json:"funded"`
	Claimed     string `json:"claimed"`
	Outstanding string `json:"outstanding"`
	RolledOver  bool   `json:"rolledOver"`
}
type treasuryAmounts struct {
	funded, claimed *big.Int
	rolled          bool
}

// TreasuryLedger tracks quote funding, claims and rollovers, excluding service
// credits. Root authorization, claim proofs and timing belong to separate checks.
type TreasuryLedger struct {
	epochs   map[string]TreasuryEpoch
	balances map[string]treasuryAmounts
}

func NewTreasuryLedger(epochs []TreasuryEpoch) (*TreasuryLedger, error) {
	if len(epochs) > 10000 {
		return nil, ErrLedger
	}
	l := &TreasuryLedger{epochs: map[string]TreasuryEpoch{}, balances: map[string]treasuryAmounts{}}
	markets := map[string]TreasuryEpoch{}
	for _, e := range epochs {
		n, err := strconv.ParseUint(e.Epoch, 10, 32)
		if err != nil || n == 0 || e.Epoch != strconv.FormatUint(n, 10) || !hash.MatchString(e.MarketID) || !address.MatchString(e.Quote) || !address.MatchString(e.Distributor) || e.Distributor == zero {
			return nil, ErrLedger
		}
		if prior, ok := markets[e.MarketID]; ok && (prior.Distributor != e.Distributor || prior.Quote != e.Quote) {
			return nil, ErrLedger
		}
		key := e.Distributor + ":" + e.MarketID + ":" + e.Epoch
		if _, ok := l.epochs[key]; ok {
			return nil, ErrLedger
		}
		markets[e.MarketID] = e
		l.epochs[key] = e
		l.balances[key] = treasuryAmounts{funded: new(big.Int), claimed: new(big.Int)}
	}
	return l, nil
}
func (l *TreasuryLedger) ApplyTransaction(inputs []Input) (bool, error) {
	if err := validateTransactionInputs(inputs); err != nil {
		return false, err
	}
	staged := map[string]treasuryAmounts{}
	for key, b := range l.balances {
		staged[key] = treasuryAmounts{funded: new(big.Int).Set(b.funded), claimed: new(big.Int).Set(b.claimed), rolled: b.rolled}
	}
	changed := false
	for _, in := range inputs {
		if in.Module != "TreasuryDistributorV1" {
			continue
		}
		d, err := events.Decode(in.Module, in.Log)
		if err != nil {
			return false, err
		}
		name := strings.SplitN(d.Signature, "(", 2)[0]
		if name != "QuoteTreasuryFunded" && name != "TreasuryClaimed" && name != "EpochRemainderRolledOver" {
			continue
		}
		get := func(field string) string { s, _ := d.Args[field].(string); return s }
		epoch := get("epochId")
		if name == "EpochRemainderRolledOver" {
			epoch = get("fromEpochId")
		}
		key := in.Log.Address + ":" + get("marketId") + ":" + epoch
		e, ok := l.epochs[key]
		if !ok {
			return false, ErrLedger
		}
		b := staged[key]
		if b.rolled {
			return false, ErrLedger
		}
		raw := get("amount")
		if len(raw) > 78 {
			return false, ErrLedger
		}
		amount, ok := new(big.Int).SetString(raw, 10)
		if !ok || amount.Sign() < 0 || amount.BitLen() > 256 || amount.String() != raw {
			return false, ErrLedger
		}
		switch name {
		case "QuoteTreasuryFunded":
			if amount.Sign() == 0 || get("quoteToken") != e.Quote {
				return false, ErrLedger
			}
			b.funded.Add(b.funded, amount)
		case "TreasuryClaimed":
			if amount.Sign() == 0 {
				return false, ErrLedger
			}
			b.claimed.Add(b.claimed, amount)
			if b.claimed.Cmp(b.funded) > 0 {
				return false, ErrLedger
			}
		case "EpochRemainderRolledOver":
			from, _ := strconv.ParseUint(epoch, 10, 32)
			to, err := strconv.ParseUint(get("toEpochId"), 10, 32)
			destination := in.Log.Address + ":" + get("marketId") + ":" + get("toEpochId")
			target, exists := staged[destination]
			if err != nil || to <= from || !exists || target.rolled || new(big.Int).Sub(b.funded, b.claimed).Cmp(amount) != 0 {
				return false, ErrLedger
			}
			target.funded.Add(target.funded, amount)
			staged[destination] = target
			b.funded.SetUint64(0)
			b.rolled = true
		}
		staged[key] = b
		changed = true
	}
	totals := map[string]*big.Int{}
	for key, b := range staged {
		if b.funded.Sign() < 0 || b.funded.BitLen() > 256 || b.claimed.Sign() < 0 || b.claimed.BitLen() > 256 {
			return false, ErrLedger
		}
		if !b.rolled {
			unpaid := new(big.Int).Sub(b.funded, b.claimed)
			if unpaid.Sign() < 0 {
				return false, ErrLedger
			}
			e := l.epochs[key]
			assetKey := e.Distributor + ":" + e.Quote
			if totals[assetKey] == nil {
				totals[assetKey] = new(big.Int)
			}
			totals[assetKey].Add(totals[assetKey], unpaid)
			if totals[assetKey].BitLen() > 256 {
				return false, ErrLedger
			}
		}
	}
	l.balances = staged
	return changed, nil
}
func (l *TreasuryLedger) Snapshot() []TreasuryBalance {
	keys := make([]string, 0, len(l.epochs))
	for key := range l.epochs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]TreasuryBalance, 0, len(keys))
	for _, key := range keys {
		e, b := l.epochs[key], l.balances[key]
		outstanding := new(big.Int)
		if !b.rolled {
			outstanding.Sub(b.funded, b.claimed)
		}
		out = append(out, TreasuryBalance{MarketID: e.MarketID, Epoch: e.Epoch, QuoteAsset: e.Quote, Distributor: e.Distributor, Funded: b.funded.String(), Claimed: b.claimed.String(), Outstanding: outstanding.String(), RolledOver: b.rolled})
	}
	return out
}
