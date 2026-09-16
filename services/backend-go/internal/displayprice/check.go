package displayprice

import (
	"context"
	"time"
)

// Check refreshes the configured targets once using the same bounded path as Run.
// Its result is a point-in-time display availability check, never execution approval.
func (s *Service) Check(ctx context.Context) CheckResult {
	s.refresh(ctx)
	now := time.Now().UTC()
	refs := s.Read(now)
	ok := ctx.Err() == nil
	for _, r := range refs {
		if r.Status != "available" {
			ok = false
		}
	}
	return CheckResult{DisplayOnly: true, CheckedAt: now, AllAvailable: ok, References: refs}
}

type CheckResult struct {
	DisplayOnly  bool        `json:"displayOnly"`
	CheckedAt    time.Time   `json:"checkedAt"`
	AllAvailable bool        `json:"allAvailable"`
	References   []Reference `json:"references"`
}
