package analytics

import "tickergarden/backend/internal/chainrpc"

// CommittedReceiptBlock carries the commitment written atomically by the journal
// at observation time. It must come from the same canonical read transaction as
// its receipts. This is a local integrity commitment, not an Ethereum receipt root.
type CommittedReceiptBlock struct {
	Number         string
	Hash           string
	ReceiptCount   int
	ReceiptSetHash string
	Receipts       []chainrpc.Receipt
}

func DecodeCommittedHolderTransfers(chain uint64, token string, blocks []CommittedReceiptBlock, logs []chainrpc.Log) ([]HolderTransfer, error) {
	if len(blocks) == 0 || len(blocks) > 1000000 {
		return nil, ErrHolders
	}
	receipts := []chainrpc.Receipt{}
	var previous uint64
	for i, b := range blocks {
		n, err := uint256(b.Number)
		if err != nil || !n.IsUint64() || !hashRE.MatchString(b.Hash) || b.ReceiptCount != len(b.Receipts) {
			return nil, ErrHolders
		}
		if i > 0 && (previous == ^uint64(0) || n.Uint64() != previous+1) {
			return nil, ErrHolders
		}
		previous = n.Uint64()
		digest, err := chainrpc.ReceiptSetCommitment(b.Receipts)
		if err != nil || digest != b.ReceiptSetHash {
			return nil, ErrHolders
		}
		for _, r := range b.Receipts {
			number, err := chainrpc.Quantity(r.BlockNumber)
			if err != nil || number != previous || r.BlockHash != b.Hash {
				return nil, ErrHolders
			}
		}
		if len(receipts)+len(b.Receipts) > 100000 {
			return nil, ErrHolders
		}
		receipts = append(receipts, b.Receipts...)
	}
	return DecodeHolderTransfers(chain, token, receipts, logs)
}
