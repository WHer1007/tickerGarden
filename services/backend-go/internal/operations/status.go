// Package operations reports stored pipeline signals, not deployment readiness.
package operations

import (
	"strconv"
	"time"
)

type Stage struct {
	Name        string  `json:"name"`
	Height      *uint64 `json:"-"`
	BlockNumber *string `json:"blockNumber"`
	Canonical   bool    `json:"canonical"`
	LagBlocks   *string `json:"lagBlocks"`
}
type Status struct {
	ReceiptRootMissing          *int       `json:"receiptRootMissing"`
	GenesisHash                 string     `json:"-"`
	StoredFinalizedHash         *string    `json:"-"`
	RPC                         *RPCStatus `json:"rpc,omitempty"`
	FinalizedCanonical          bool       `json:"finalizedCanonical"`
	ChainID                     uint64     `json:"chainId"`
	ObservedAt                  time.Time  `json:"observedAt"`
	StoredFinalized             *string    `json:"storedFinalized"`
	LastJournalProgress         *time.Time `json:"lastJournalProgress"`
	Stages                      []Stage    `json:"stages"`
	PrincipalFailed             *int       `json:"principalFailed"`
	PrincipalMissing            *int       `json:"principalMissing"`
	Alerts                      []string   `json:"alerts"`
	State                       string     `json:"state"`
	ProductionReadinessVerified bool       `json:"productionReadinessVerified"`
}

// Evaluate only compares stored checkpoints. A quiet RPC/chain can leave the
// finalized reference stale; journal progress age is a separate signal.
func Evaluate(s Status, finalized *uint64, maxLag uint64, maxAge time.Duration) Status {
	s.Alerts = append([]string{}, s.Alerts...)
	s.Stages = append([]Stage{}, s.Stages...)
	s.ProductionReadinessVerified = false
	s.StoredFinalized = nil
	if finalized == nil {
		s.Alerts = append(s.Alerts, "finalized_reference_missing")
	} else {
		v := strconv.FormatUint(*finalized, 10)
		s.StoredFinalized = &v
		if !s.FinalizedCanonical {
			s.Alerts = append(s.Alerts, "finalized_reference_noncanonical")
		}
	}
	if s.LastJournalProgress == nil {
		s.Alerts = append(s.Alerts, "journal_progress_missing")
	} else if s.ObservedAt.Sub(*s.LastJournalProgress) > maxAge {
		s.Alerts = append(s.Alerts, "journal_progress_stale")
	} else if s.LastJournalProgress.After(s.ObservedAt) {
		s.Alerts = append(s.Alerts, "journal_progress_in_future")
	}
	upstream := finalized
	for i := range s.Stages {
		stage := &s.Stages[i]
		stage.BlockNumber = nil
		stage.LagBlocks = nil
		if stage.Height == nil {
			s.Alerts = append(s.Alerts, stage.Name+"_missing")
		} else {
			v := strconv.FormatUint(*stage.Height, 10)
			stage.BlockNumber = &v
			if !stage.Canonical {
				s.Alerts = append(s.Alerts, stage.Name+"_noncanonical")
			}
			if upstream != nil {
				if stage.Name == "journal" && *stage.Height >= *upstream {
					v := "0"
					stage.LagBlocks = &v
				} else if *stage.Height > *upstream {
					s.Alerts = append(s.Alerts, stage.Name+"_ahead_of_source")
				} else {
					lag := *upstream - *stage.Height
					v := strconv.FormatUint(lag, 10)
					stage.LagBlocks = &v
					if lag > maxLag {
						s.Alerts = append(s.Alerts, stage.Name+"_backlog")
					}
				}
			}
		}
		if stage.Name != "journal" {
			upstream = stage.Height
		}
	}
	if s.PrincipalFailed == nil || s.PrincipalMissing == nil {
		s.Alerts = append(s.Alerts, "principal_report_missing")
	} else {
		if *s.PrincipalFailed > 0 {
			s.Alerts = append(s.Alerts, "principal_checks_failed")
		}
		if *s.PrincipalMissing > 0 {
			s.Alerts = append(s.Alerts, "principal_probes_missing")
		}
	}
	if s.ReceiptRootMissing == nil {
		s.Alerts = append(s.Alerts, "receipt_root_coverage_unknown")
	} else if *s.ReceiptRootMissing < 0 {
		s.Alerts = append(s.Alerts, "receipt_root_coverage_invalid")
	} else if *s.ReceiptRootMissing > 0 {
		s.Alerts = append(s.Alerts, "receipt_root_backfill_pending")
	}
	s.State = "within_monitoring_thresholds"
	if len(s.Alerts) > 0 {
		s.State = "attention"
	}
	return s
}
