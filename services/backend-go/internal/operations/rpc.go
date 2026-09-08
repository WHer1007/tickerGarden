package operations

import (
	"context"
	"regexp"
	"strconv"
	"time"

	"tickergarden/backend/internal/chainrpc"
)

type RPCObserver interface {
	ChainID(context.Context) (uint64, error)
	Header(context.Context, string) (chainrpc.Header, error)
}
type RPCStatus struct {
	ObservedAt                 time.Time `json:"observedAt"`
	DurationMS                 int64     `json:"durationMs"`
	IdentityVerified           bool      `json:"identityVerified"`
	LatestBlock                string    `json:"latestBlock"`
	LatestHash                 string    `json:"latestHash"`
	FinalizedBlock             string    `json:"finalizedBlock"`
	FinalizedHash              string    `json:"finalizedHash"`
	JournalLagBlocks           *string   `json:"journalLagBlocks"`
	FinalizedLagBlocks         *string   `json:"finalizedLagBlocks"`
	StoredFinalizedHashMatches *bool     `json:"storedFinalizedHashMatches"`
}

var rpcHash = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

// ObserveRPC performs a separate observation after the database transaction. It
// does not hold the chain lock across network I/O or reinterpret DB snapshot time.
func ObserveRPC(ctx context.Context, s Status, rpc RPCObserver, maxLag uint64) (Status, error) {
	fail := func() (Status, error) { return Status{}, ErrStatus }
	started := time.Now()
	if !rpcHash.MatchString(s.GenesisHash) {
		return fail()
	}
	chain, e := rpc.ChainID(ctx)
	if e != nil || chain != s.ChainID {
		return fail()
	}
	genesis, e := rpc.Header(ctx, "0x0")
	if e != nil || genesis.Number != "0x0" || genesis.Hash != s.GenesisHash {
		return fail()
	}
	latest, e := rpc.Header(ctx, "latest")
	if e != nil {
		return fail()
	}
	head, e := latest.Height()
	if e != nil || !rpcHash.MatchString(latest.Hash) {
		return fail()
	}
	final, e := rpc.Header(ctx, "finalized")
	if e != nil {
		return fail()
	}
	finalized, e := final.Height()
	if e != nil || finalized > head || !rpcHash.MatchString(final.Hash) {
		return fail()
	}
	pinned, e := rpc.Header(ctx, final.Number)
	if e != nil || pinned.Number != final.Number || pinned.Hash != final.Hash {
		return fail()
	}
	pinned, e = rpc.Header(ctx, latest.Number)
	if e != nil || pinned.Number != latest.Number || pinned.Hash != latest.Hash {
		return fail()
	}
	r := RPCStatus{IdentityVerified: true, LatestBlock: strconv.FormatUint(head, 10), LatestHash: latest.Hash, FinalizedBlock: strconv.FormatUint(finalized, 10), FinalizedHash: final.Hash}
	s.Alerts = append([]string{}, s.Alerts...)
	for _, stage := range s.Stages {
		if stage.Name == "journal" && stage.Height != nil {
			if *stage.Height > head {
				s.Alerts = append(s.Alerts, "rpc_head_behind_journal")
			} else {
				lag := head - *stage.Height
				v := strconv.FormatUint(lag, 10)
				r.JournalLagBlocks = &v
				if lag > maxLag {
					s.Alerts = append(s.Alerts, "rpc_journal_backlog")
				}
			}
		}
	}
	if s.StoredFinalized != nil {
		stored, e := strconv.ParseUint(*s.StoredFinalized, 10, 63)
		if e != nil || s.StoredFinalizedHash == nil || !rpcHash.MatchString(*s.StoredFinalizedHash) {
			return fail()
		}
		if stored > finalized {
			s.Alerts = append(s.Alerts, "rpc_finality_regression")
		} else {
			lag := finalized - stored
			v := strconv.FormatUint(lag, 10)
			r.FinalizedLagBlocks = &v
			if lag > maxLag {
				s.Alerts = append(s.Alerts, "rpc_finalized_backlog")
			}
			anchor, e := rpc.Header(ctx, "0x"+strconv.FormatUint(stored, 16))
			if e != nil || anchor.Number != "0x"+strconv.FormatUint(stored, 16) || !rpcHash.MatchString(anchor.Hash) {
				return fail()
			}
			matches := anchor.Hash == *s.StoredFinalizedHash
			r.StoredFinalizedHashMatches = &matches
			if !matches {
				s.Alerts = append(s.Alerts, "rpc_finalized_anchor_changed")
			}
		}
	}
	r.ObservedAt = time.Now().UTC()
	r.DurationMS = time.Since(started).Milliseconds()
	s.RPC = &r
	s.ProductionReadinessVerified = false
	s.State = "within_monitoring_thresholds"
	if len(s.Alerts) > 0 {
		s.State = "attention"
	}
	return s, nil
}
