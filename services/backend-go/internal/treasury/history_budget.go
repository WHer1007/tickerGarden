package treasury

import "errors"

// Receipt validation streams through the database. Unrelated chain activity is
// not retained in the candidate and must not consume its 64 MiB payload budget.
// Separate scan and per-receipt limits still bound work and individual decodes.
const MaxHistoryReceiptScanBytes uint64 = 4 << 30

type historyBudget struct {
	scanned  uint64
	retained int
}

func (b *historyBudget) receipt(size int) error {
	if size < 0 || size > MaxHistoryPayloadBytes || uint64(size) > MaxHistoryReceiptScanBytes-b.scanned {
		return errors.New("Treasury receipt scan budget exceeded")
	}
	b.scanned += uint64(size)
	return nil
}

func (b *historyBudget) retain(size int) error {
	if size < 0 || size > MaxHistoryPayloadBytes-b.retained {
		return errors.New("Treasury history byte budget exceeded")
	}
	b.retained += size
	return nil
}
