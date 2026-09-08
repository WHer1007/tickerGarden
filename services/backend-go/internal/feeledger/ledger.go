// Package feeledger replays configured FeeVault liabilities from canonical events.
// Callers must establish complete, ordered, unique, canonical log coverage.
package feeledger

import (
	"errors"
	"math/big"
	"regexp"
	"sort"
	"strings"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

type Market struct{ ID, Meme, Quote, Distributor, DistributorModule string }
type Balance struct {
	MarketID string    `json:"marketId"`
	Asset    string    `json:"asset"`
	Buckets  [5]string `json:"buckets"`
}
type Ledger struct {
	deferBounds bool
	vault       string
	markets     map[string]Market
	balances    map[string][5]*big.Int
	totals      map[string]*big.Int
}

var address = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var hash = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var maximum = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
var ErrLedger = errors.New("fee event ledger incomplete or inconsistent")

const zero = "0x0000000000000000000000000000000000000000"

func New(vault string, markets []Market) (*Ledger, error) {
	if !address.MatchString(vault) || vault == zero || len(markets) > 1000 {
		return nil, ErrLedger
	}
	l := &Ledger{vault: vault, markets: map[string]Market{}, balances: map[string][5]*big.Int{}, totals: map[string]*big.Int{}}
	for _, m := range markets {
		if _, ok := l.markets[m.ID]; ok {
			return nil, ErrLedger
		}
		if !hash.MatchString(m.ID) || !address.MatchString(m.Meme) || m.Meme == zero || !address.MatchString(m.Quote) || m.Meme == m.Quote {
			return nil, ErrLedger
		}
		if m.Distributor != "" && (!address.MatchString(m.Distributor) || m.Distributor == zero || (m.DistributorModule != "TreasuryDistributorV1" && m.DistributorModule != "HolderRewardsDistributorV1")) {
			return nil, ErrLedger
		}
		l.markets[m.ID] = m
		for _, asset := range []string{m.Meme, m.Quote} {
			l.balances[m.ID+":"+asset] = [5]*big.Int{new(big.Int), new(big.Int), new(big.Int), new(big.Int), new(big.Int)}
			l.totals[asset] = new(big.Int)
		}
	}
	return l, nil
}

// Apply validates a single event, including intermediate uint256 bounds.
// Canonical receipt replay should use ApplyTransaction to handle conversion
// callbacks whose emitted credits precede the net debit event.
func (l *Ledger) Apply(module string, log chainrpc.Log) (bool, error) {
	if module != "ProtocolFeeVault" && module != "TreasuryDistributorV1" && module != "HolderRewardsDistributorV1" {
		return false, nil
	}
	decoded, err := events.Decode(module, log)
	if err != nil {
		return false, err
	}
	name := strings.SplitN(decoded.Signature, "(", 2)[0]
	return l.apply(module, log.Address, name, decoded.Args)
}
func (l *Ledger) apply(module, emitter, name string, a map[string]any) (bool, error) {
	if module == "ProtocolFeeVault" && emitter != l.vault {
		return false, ErrLedger
	}
	if module == "ProtocolFeeVault" {
		switch name {
		case "RawRewardExitCancelled", "RawRewardExitRequested", "RewardBatchConverted", "SettlementOperatorUpdated":
			return false, nil
		}
	} else if name != "QuoteTreasuryFunded" && name != "HolderStreamFunded" {
		return false, nil
	}
	id, _ := a["marketId"].(string)
	m, ok := l.markets[id]
	if !ok {
		return false, ErrLedger
	}
	if module != "ProtocolFeeVault" {
		if module != m.DistributorModule || emitter != m.Distributor {
			return false, ErrLedger
		}
		if name == "QuoteTreasuryFunded" && a["funder"] != l.vault {
			return false, nil
		}
	}
	number := func(field string) (*big.Int, error) {
		s, ok := a[field].(string)
		if !ok || len(s) > 78 {
			return nil, ErrLedger
		}
		n, ok := new(big.Int).SetString(s, 10)
		if !ok || n.Sign() < 0 || n.Cmp(maximum) > 0 || n.String() != s {
			return nil, ErrLedger
		}
		return n, nil
	}
	changes := map[string][5]*big.Int{}
	totals := map[string]*big.Int{}
	change := func(asset string, bucket int, field string, negative bool) error {
		if asset != m.Meme && asset != m.Quote {
			return ErrLedger
		}
		n, e := number(field)
		if e != nil {
			return e
		}
		if negative {
			n.Neg(n)
		}
		key := id + ":" + asset
		b, ok := changes[key]
		if !ok {
			for i, v := range l.balances[key] {
				b[i] = new(big.Int).Set(v)
			}
		}
		b[bucket].Add(b[bucket], n)
		if !l.deferBounds && (b[bucket].Sign() < 0 || b[bucket].Cmp(maximum) > 0) {
			return ErrLedger
		}
		changes[key] = b
		total, ok := totals[asset]
		if !ok {
			total = new(big.Int).Set(l.totals[asset])
		}
		total.Add(total, n)
		totals[asset] = total
		return nil
	}
	asset, _ := a["feeAsset"].(string)
	var e error
	switch name {
	case "FeeBucketsCredited":
		for i, field := range []string{"creatorAmount", "stakerAmount", "platformAmount"} {
			if e = change(asset, i, field, false); e != nil {
				return false, e
			}
		}
	case "CurveFeesSwept":
		asset, _ = a["quoteAsset"].(string)
		if asset != m.Quote {
			return false, ErrLedger
		}
		if e = change(asset, 0, "creatorAmount", false); e == nil {
			e = change(asset, 2, "platformAmount", false)
		}
	case "HolderFeesAccrued":
		e = change(asset, 3, "amount", false)
	case "FeeClaimed":
		role, err := number("beneficiaryType")
		if err != nil || !role.IsUint64() || role.Uint64() > 2 {
			return false, ErrLedger
		}
		e = change(asset, int(role.Uint64()), "amount", true)
	case "ForfeitureReserved":
		e = change(asset, 1, "amount", true)
		if e == nil {
			e = change(asset, 4, "amount", false)
		}
		expected, err := number("reserveBalance")
		if e != nil || err != nil || changes[id+":"+asset][4].Cmp(expected) != 0 {
			return false, ErrLedger
		}
	case "ForfeitureReserveConverted":
		amount, err := number("amount")
		current, ok := l.balances[id+":"+asset]
		if err != nil || !ok || amount.Cmp(current[4]) != 0 {
			return false, ErrLedger
		}
		e = change(asset, 4, "amount", true)
		if e == nil {
			e = change(asset, 2, "amount", false)
		}
	case "RewardConverted", "HolderRewardsConverted":
		bucket := 3
		if name == "RewardConverted" {
			epoch, err := number("creatorEpoch")
			if err != nil || epoch.BitLen() > 32 {
				return false, ErrLedger
			}
			bucket = 0
			if epoch.Sign() == 0 {
				bucket = 1
			}
		} else if a["memeAsset"] != m.Meme || a["quoteAsset"] != m.Quote {
			return false, ErrLedger
		}
		e = change(m.Meme, bucket, "memeSpent", true)
		if e == nil {
			e = change(m.Quote, bucket, "quoteReceived", false)
		}
	case "QuoteTreasuryFunded":
		if a["quoteToken"] != m.Quote {
			return false, ErrLedger
		}
		e = change(m.Quote, 3, "amount", true)
	case "HolderStreamFunded":
		e = change(m.Quote, 3, "amount", true)
	default:
		return false, ErrLedger
	}
	if e != nil {
		return false, e
	}
	for _, n := range totals {
		if !l.deferBounds && (n.Sign() < 0 || n.Cmp(maximum) > 0) {
			return false, ErrLedger
		}
	}
	for key, b := range changes {
		l.balances[key] = b
	}
	for asset, n := range totals {
		l.totals[asset] = n
	}
	return true, nil
}
func (l *Ledger) Snapshot() []Balance {
	keys := make([]string, 0, len(l.balances))
	for key := range l.balances {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]Balance, 0, len(keys))
	for _, key := range keys {
		parts := strings.Split(key, ":")
		b := Balance{MarketID: parts[0], Asset: parts[1]}
		for i, n := range l.balances[key] {
			b.Buckets[i] = n.String()
		}
		out = append(out, b)
	}
	return out
}
