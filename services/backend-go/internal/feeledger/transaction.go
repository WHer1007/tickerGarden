package feeledger

import (
	"math/big"

	"tickergarden/backend/internal/chainrpc"
)

type Input struct {
	Module string
	Log    chainrpc.Log
}

// ApplyTransaction atomically replays one transaction's ordered event inventory.
// Conversion events describe net debits after the router has emitted new credits;
// therefore event-order intermediate balances are not contract-state balances.
// Bounds are checked at transaction end. The caller must authenticate canonical
// receipts and complete event coverage; this method cannot prove either property.
func (l *Ledger) ApplyTransaction(inputs []Input) (bool, error) {
	if err := validateTransactionInputs(inputs); err != nil {
		return false, err
	}
	staged := &Ledger{vault: l.vault, markets: l.markets, balances: map[string][5]*big.Int{}, totals: map[string]*big.Int{}, deferBounds: true}
	for key, buckets := range l.balances {
		var copy [5]*big.Int
		for i, value := range buckets {
			copy[i] = new(big.Int).Set(value)
		}
		staged.balances[key] = copy
	}
	for key, value := range l.totals {
		staged.totals[key] = new(big.Int).Set(value)
	}
	changed := false
	for _, input := range inputs {
		applied, err := staged.Apply(input.Module, input.Log)
		if err != nil {
			return false, err
		}
		changed = changed || applied
	}
	for _, buckets := range staged.balances {
		for _, value := range buckets {
			if value.Sign() < 0 || value.Cmp(maximum) > 0 {
				return false, ErrLedger
			}
		}
	}
	for _, value := range staged.totals {
		if value.Sign() < 0 || value.Cmp(maximum) > 0 {
			return false, ErrLedger
		}
	}
	l.balances, l.totals = staged.balances, staged.totals
	return changed, nil
}

func validateTransactionInputs(inputs []Input) error {
	if len(inputs) == 0 || len(inputs) > 10000 {
		return ErrLedger
	}
	first := inputs[0].Log
	if !hash.MatchString(first.BlockHash) || !hash.MatchString(first.TransactionHash) {
		return ErrLedger
	}
	if _, err := chainrpc.Quantity(first.BlockNumber); err != nil {
		return ErrLedger
	}
	if _, err := chainrpc.Quantity(first.TransactionIndex); err != nil {
		return ErrLedger
	}
	var previous uint64
	size := 0
	for i, input := range inputs {
		log := input.Log
		index, err := chainrpc.Quantity(log.LogIndex)
		if err != nil || (i > 0 && index <= previous) || log.Removed ||
			log.BlockNumber != first.BlockNumber || log.BlockHash != first.BlockHash ||
			log.TransactionHash != first.TransactionHash || log.TransactionIndex != first.TransactionIndex || len(log.Topics) > 4 {
			return ErrLedger
		}
		previous = index
		size += len(log.Data) + len(input.Module) + len(log.Address)
		for _, topic := range log.Topics {
			size += len(topic)
		}
		if size > 16<<20 {
			return ErrLedger
		}
	}

	return nil
}
