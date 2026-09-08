package feeledger

import (
	"math/big"
	"strings"

	"tickergarden/backend/internal/events"
)

type HolderEpoch struct{ MarketID, Epoch, Meme, Quote, Distributor, DistributorModule string }

// HolderLedger tracks funds still owed by FeeVault per accounting epoch.
// Transfers to a distributor discharge that liability; downstream user claims
// belong to a separate distributor ledger and must not debit FeeVault again.
type HolderLedger struct {
	*epochLedger
	distributors map[string]HolderEpoch
}

func NewHolderLedger(vault string, epochs []HolderEpoch) (*HolderLedger, error) {
	if len(epochs) > 10000 {
		return nil, ErrLedger
	}
	configs := make([]CreatorEpoch, 0, len(epochs))
	bindings := map[string]HolderEpoch{}
	for _, e := range epochs {
		if !address.MatchString(e.Distributor) || e.Distributor == zero || (e.DistributorModule != "TreasuryDistributorV1" && e.DistributorModule != "HolderRewardsDistributorV1") || (e.DistributorModule == "HolderRewardsDistributorV1" && e.Epoch != "1") {
			return nil, ErrLedger
		}
		if prior, ok := bindings[e.MarketID]; ok && (prior.Distributor != e.Distributor || prior.DistributorModule != e.DistributorModule) {
			return nil, ErrLedger
		}
		bindings[e.MarketID] = e
		configs = append(configs, CreatorEpoch{MarketID: e.MarketID, Epoch: e.Epoch, Meme: e.Meme, Quote: e.Quote})
	}
	l, err := newEpochLedger(vault, configs)
	if err != nil {
		return nil, err
	}
	return &HolderLedger{epochLedger: l, distributors: bindings}, nil
}
func (l *HolderLedger) ApplyTransaction(inputs []Input) (bool, error) {
	if err := validateTransactionInputs(inputs); err != nil {
		return false, err
	}
	staged := map[string]*big.Int{}
	for key, value := range l.balances {
		staged[key] = new(big.Int).Set(value)
	}
	changed := false
	for _, in := range inputs {
		if in.Module != "ProtocolFeeVault" && in.Module != "TreasuryDistributorV1" && in.Module != "HolderRewardsDistributorV1" {
			continue
		}
		d, err := events.Decode(in.Module, in.Log)
		if err != nil {
			return false, err
		}
		get := func(field string) string { s, _ := d.Args[field].(string); return s }
		name := strings.SplitN(d.Signature, "(", 2)[0]
		if in.Module == "ProtocolFeeVault" {
			if in.Log.Address != l.vault {
				return false, ErrLedger
			}
			if name != "HolderFeesAccrued" && name != "HolderRewardsConverted" {
				continue
			}
		} else if name != "QuoteTreasuryFunded" && name != "HolderStreamFunded" {
			continue
		}
		binding, ok := l.distributors[get("marketId")]
		if !ok {
			return false, ErrLedger
		}
		epoch := get("epochId")
		if in.Module != "ProtocolFeeVault" {
			if in.Log.Address != binding.Distributor || in.Module != binding.DistributorModule {
				return false, ErrLedger
			}
			if name == "QuoteTreasuryFunded" && get("funder") != l.vault {
				continue
			}
			if name == "HolderStreamFunded" {
				epoch = "1"
			}
		}
		e, ok := l.epochs[get("marketId")+":"+epoch]
		if !ok {
			return false, ErrLedger
		}
		change := func(asset, field string, negative bool) error {
			value, ok := staged[e.MarketID+":"+epoch+":"+asset]
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
		case "HolderFeesAccrued":
			err = change(get("feeAsset"), "amount", false)
		case "HolderRewardsConverted":
			if get("memeAsset") != e.Meme || get("quoteAsset") != e.Quote {
				return false, ErrLedger
			}
			err = change(e.Meme, "memeSpent", true)
			if err == nil {
				err = change(e.Quote, "quoteReceived", false)
			}
		case "QuoteTreasuryFunded":
			if get("quoteToken") != e.Quote {
				return false, ErrLedger
			}
			err = change(e.Quote, "amount", true)
		case "HolderStreamFunded":
			err = change(e.Quote, "amount", true)
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
