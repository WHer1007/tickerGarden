package feeledger

import (
	"math/big"
	"sort"
	"strconv"
	"strings"

	"tickergarden/backend/internal/events"
)

type CreatorEpoch struct{ MarketID, Epoch, Meme, Quote string }
type EpochBalance struct {
	MarketID string `json:"marketId"`
	Epoch    string `json:"epoch"`
	Asset    string `json:"asset"`
	Amount   string `json:"amount"`
}

// CreatorLedger tracks unpaid per-epoch liabilities, not beneficiary ownership,
// exit readiness or full entitlement provenance. Configuration and complete
// canonical transaction inventories must be authenticated by the caller.
type CreatorBalance = EpochBalance

type CreatorLedger struct{ *epochLedger }

type epochLedger struct {
	vault    string
	epochs   map[string]CreatorEpoch
	balances map[string]*big.Int
}

func NewCreatorLedger(vault string, epochs []CreatorEpoch) (*CreatorLedger, error) {
	l, err := newEpochLedger(vault, epochs)
	if err != nil {
		return nil, err
	}
	return &CreatorLedger{l}, nil
}
func newEpochLedger(vault string, epochs []CreatorEpoch) (*epochLedger, error) {
	if !address.MatchString(vault) || vault == zero || len(epochs) > 10000 {
		return nil, ErrLedger
	}
	l := &epochLedger{vault: vault, epochs: map[string]CreatorEpoch{}, balances: map[string]*big.Int{}}
	markets := map[string]CreatorEpoch{}
	for _, e := range epochs {
		n, err := strconv.ParseUint(e.Epoch, 10, 32)
		key := e.MarketID + ":" + e.Epoch
		if err != nil || n == 0 || e.Epoch != strconv.FormatUint(n, 10) || !hash.MatchString(e.MarketID) || !address.MatchString(e.Meme) || e.Meme == zero || !address.MatchString(e.Quote) || e.Meme == e.Quote {
			return nil, ErrLedger
		}
		if _, ok := l.epochs[key]; ok {
			return nil, ErrLedger
		}
		if prior, ok := markets[e.MarketID]; ok && (prior.Meme != e.Meme || prior.Quote != e.Quote) {
			return nil, ErrLedger
		}
		markets[e.MarketID] = e
		l.epochs[key] = e
		l.balances[key+":"+e.Meme] = new(big.Int)
		l.balances[key+":"+e.Quote] = new(big.Int)
	}
	return l, nil
}

func (l *CreatorLedger) ApplyTransaction(inputs []Input) (bool, error) {
	if err := validateTransactionInputs(inputs); err != nil {
		return false, err
	}
	staged := map[string]*big.Int{}
	for key, value := range l.balances {
		staged[key] = new(big.Int).Set(value)
	}
	changed := false
	for _, in := range inputs {
		if in.Module != "ProtocolFeeVault" {
			continue
		}
		if in.Log.Address != l.vault {
			return false, ErrLedger
		}
		d, err := events.Decode(in.Module, in.Log)
		if err != nil {
			return false, err
		}
		name := strings.SplitN(d.Signature, "(", 2)[0]
		get := func(field string) string { s, _ := d.Args[field].(string); return s }
		epoch := get("creatorEpoch")
		switch name {
		case "FeeBucketsCredited", "CurveFeesSwept":
		case "FeeClaimed":
			if get("beneficiaryType") != "0" {
				continue
			}
			epoch = get("beneficiaryEpoch")
		case "RewardConverted":
			if epoch == "0" {
				continue
			}
		default:
			continue
		}
		e, ok := l.epochs[get("marketId")+":"+epoch]
		if !ok {
			return false, ErrLedger
		}
		change := func(asset, field string, negative bool) error {
			value, ok := staged[e.MarketID+":"+e.Epoch+":"+asset]
			if !ok {
				return ErrLedger
			}
			raw := get(field)
			if len(raw) > 78 {
				return ErrLedger
			}
			n, ok := new(big.Int).SetString(raw, 10)
			if !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != raw {
				return ErrLedger
			}
			if negative {
				n.Neg(n)
			}
			value.Add(value, n)
			return nil
		}
		switch name {
		case "FeeBucketsCredited":
			err = change(get("feeAsset"), "creatorAmount", false)
		case "CurveFeesSwept":
			if get("quoteAsset") != e.Quote {
				return false, ErrLedger
			}
			err = change(e.Quote, "creatorAmount", false)
		case "FeeClaimed":
			err = change(get("feeAsset"), "amount", true)
		case "RewardConverted":
			err = change(e.Meme, "memeSpent", true)
			if err == nil {
				err = change(e.Quote, "quoteReceived", false)
			}
		}
		if err != nil {
			return false, err
		}
		changed = true
	}
	for _, v := range staged {
		if v.Sign() < 0 || v.BitLen() > 256 {
			return false, ErrLedger
		}
	}
	l.balances = staged
	return changed, nil
}

func (l *epochLedger) Snapshot() []EpochBalance {
	keys := make([]string, 0, len(l.balances))
	for key := range l.balances {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]EpochBalance, 0, len(keys))
	for _, key := range keys {
		p := strings.Split(key, ":")
		out = append(out, EpochBalance{MarketID: p[0], Epoch: p[1], Asset: p[2], Amount: l.balances[key].String()})
	}
	return out
}
