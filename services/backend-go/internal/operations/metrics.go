package operations

import (
	"bytes"
	"fmt"
	"strconv"
)

// Metrics encodes monitoring evidence only. Missing heights/counts are omitted,
// never substituted with zero. No wallet, hash, DSN, or free-form alert is a label.
func Metrics(s Status) ([]byte, error) {
	if (s.ChainID != 4663 && s.ChainID != 46630 && s.ChainID != 421614) || s.ObservedAt.IsZero() || s.ObservedAt.Unix() < 0 || s.ProductionReadinessVerified {
		return nil, ErrStatus
	}
	var b bytes.Buffer
	gauge := func(name, help, value, extra string) {
		fmt.Fprintf(&b, "# HELP tickergarden_pipeline_%s %s\n# TYPE tickergarden_pipeline_%s gauge\ntickergarden_pipeline_%s{chain_id=\"%d\"%s} %s\n", name, help, name, name, s.ChainID, extra, value)
	}
	flag := func(v bool) string {
		if v {
			return "1"
		}
		return "0"
	}
	number := func(value *string) bool {
		if value == nil {
			return true
		}
		v, e := strconv.ParseUint(*value, 10, 64)
		return e == nil && strconv.FormatUint(v, 10) == *value
	}
	gauge("observed_timestamp_seconds", "Database observation time; check freshness independently.", strconv.FormatInt(s.ObservedAt.Unix(), 10), "")
	gauge("attention", "Recorded monitoring conditions need attention; not production readiness.", flag(len(s.Alerts) > 0), "")
	gauge("finalized_present", "Whether a stored finalized reference exists.", flag(s.StoredFinalized != nil), "")
	if !number(s.StoredFinalized) {
		return nil, ErrStatus
	}
	if s.StoredFinalized != nil {
		gauge("finalized_height", "Stored finalized height, not necessarily current RPC finality.", *s.StoredFinalized, "")
	}
	gauge("finalized_canonical", "Stored finalized reference passed canonical checks.", flag(s.FinalizedCanonical), "")
	if s.LastJournalProgress != nil {
		if s.LastJournalProgress.Unix() < 0 {
			return nil, ErrStatus
		}
		gauge("journal_progress_timestamp_seconds", "Last stored journal progress time.", strconv.FormatInt(s.LastJournalProgress.Unix(), 10), "")
	}
	stages := map[string]Stage{}
	for _, stage := range s.Stages {
		switch stage.Name {
		case "journal", "discovery", "projection", "publication":
		default:
			return nil, ErrStatus
		}
		if _, ok := stages[stage.Name]; ok || !number(stage.BlockNumber) || !number(stage.LagBlocks) {
			return nil, ErrStatus
		}
		stages[stage.Name] = stage
	}
	// HELP/TYPE occur once per family even though stage has multiple samples.
	for _, family := range []struct{ name, help string }{{"stage_present", "Stored stage checkpoint presence."}, {"stage_canonical", "Stored stage checkpoint canonical status."}, {"stage_height", "Stored stage height."}, {"stage_lag_blocks", "Stage lag relative to its stored upstream reference."}} {
		fmt.Fprintf(&b, "# HELP tickergarden_pipeline_%s %s\n# TYPE tickergarden_pipeline_%s gauge\n", family.name, family.help, family.name)
		for _, name := range []string{"journal", "discovery", "projection", "publication"} {
			stage, ok := stages[name]
			if !ok {
				return nil, ErrStatus
			}
			var value string
			switch family.name {
			case "stage_present":
				value = flag(stage.BlockNumber != nil)
			case "stage_canonical":
				value = flag(stage.Canonical)
			case "stage_height":
				if stage.BlockNumber == nil {
					continue
				}
				value = *stage.BlockNumber
			case "stage_lag_blocks":
				if stage.LagBlocks == nil {
					continue
				}
				value = *stage.LagBlocks
			}
			fmt.Fprintf(&b, "tickergarden_pipeline_%s{chain_id=\"%d\",stage=%q} %s\n", family.name, s.ChainID, name, value)
		}
	}
	for _, entry := range []struct {
		name  string
		value *int
	}{{"principal_failed_checks", s.PrincipalFailed}, {"principal_missing_probes", s.PrincipalMissing}} {
		if entry.value != nil {
			if *entry.value < 0 {
				return nil, ErrStatus
			}
			gauge(entry.name, "Stored principal reconciliation count.", strconv.Itoa(*entry.value), "")
		}
	}
	if s.ReceiptRootMissing != nil {
		if *s.ReceiptRootMissing < 0 {
			return nil, ErrStatus
		}
		gauge("receipt_root_missing_blocks", "Canonical stored blocks awaiting receipt root evidence; not full chain coverage.", strconv.Itoa(*s.ReceiptRootMissing), "")
	}
	gauge("rpc_observed", "Whether an optional independent RPC observation is included.", flag(s.RPC != nil), "")
	if r := s.RPC; r != nil {
		if r.ObservedAt.IsZero() || r.ObservedAt.Unix() < 0 || !number(&r.LatestBlock) || !number(&r.FinalizedBlock) || !number(r.JournalLagBlocks) || !number(r.FinalizedLagBlocks) {
			return nil, ErrStatus
		}
		gauge("rpc_observed_timestamp_seconds", "Independent RPC observation time.", strconv.FormatInt(r.ObservedAt.Unix(), 10), "")
		gauge("rpc_identity_verified", "Independent RPC identity check.", flag(r.IdentityVerified), "")
		for _, entry := range []struct {
			name  string
			value *string
		}{{"rpc_latest_height", &r.LatestBlock}, {"rpc_finalized_height", &r.FinalizedBlock}, {"rpc_journal_lag_blocks", r.JournalLagBlocks}, {"rpc_finalized_lag_blocks", r.FinalizedLagBlocks}} {
			if entry.value != nil {
				gauge(entry.name, "Independent RPC observation value.", *entry.value, "")
			}
		}
	}
	return b.Bytes(), nil
}
