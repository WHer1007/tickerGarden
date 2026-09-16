package deployment

import (
	"context"
	"fmt"

	"tickergarden/backend/internal/chainrpc"
)

// requestFixture is the authenticated, historical-header fixture shared by
// request and market-identity observations. It is intentionally independent
// of the Treasury success-path setup.
type requestFixture struct {
	*feeFixture
	now, sourceTime uint64
	sourceReads     int
	lateReorg       bool
}

func (f *requestFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	h := chainrpc.Header{Number: tag, Hash: blockHash, Timestamp: fmt.Sprintf("0x%x", f.now)}
	if tag == "0x0" {
		f.sourceReads++
		h.Hash = genesisHash
		h.Timestamp = fmt.Sprintf("0x%x", f.sourceTime)
	} else if f.lateReorg && f.sourceReads >= 2 {
		h.Hash = genesisHash
	}
	return h, nil
}
