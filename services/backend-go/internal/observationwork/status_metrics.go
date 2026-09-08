package observationwork

import (
	"bytes"
	"fmt"
	"math"
	"strconv"
	"time"
)

// QueueMetrics has no high-cardinality labels. All values describe retained
// database-global cache rows and can decrease after cache cleanup.
func QueueMetrics(s QueueStatus) ([]byte, error) {
	if _, e := EvaluateQueueStatus(s, time.Hour); e != nil || s.ObservedAt.Unix() < 0 {
		return nil, ErrQueueStatus
	}
	var b bytes.Buffer
	gauge := func(name, help, value string) {
		fmt.Fprintf(&b, "# HELP tickergarden_observation_%s %s\n# TYPE tickergarden_observation_%s gauge\ntickergarden_observation_%s %s\n", name, help, name, name, value)
	}
	gauge("observed_timestamp_seconds", "Database observation time; not chain freshness.", strconv.FormatInt(s.ObservedAt.Unix(), 10))
	for _, v := range []struct {
		name string
		n    int64
	}{{"retained_jobs", s.Total}, {"pending_jobs", s.Pending}, {"running_jobs", s.Running}, {"complete_jobs", s.Complete}, {"retry_ready_jobs", s.RetryReady}, {"retry_deferred_jobs", s.RetryDeferred}, {"expired_lease_jobs", s.ExpiredLeases}, {"repeated_failure_jobs", s.RepeatedFailures}, {"invalid_jobs", s.InvalidRows}} {
		gauge(v.name, "Retained observation cache jobs across all chains and releases in this database.", strconv.FormatInt(v.n, 10))
	}
	if s.PendingAgeSeconds != nil {
		if math.IsNaN(*s.PendingAgeSeconds) || math.IsInf(*s.PendingAgeSeconds, 0) || *s.PendingAgeSeconds < 0 {
			return nil, ErrQueueStatus
		}
		gauge("pending_update_age_seconds", "Age since oldest pending job update; not original enqueue age.", strconv.FormatFloat(*s.PendingAgeSeconds, 'f', 3, 64))
	}
	attention := "0"
	if len(s.Alerts) > 0 {
		attention = "1"
	}
	gauge("attention", "Operational queue signals only; never financial verification.", attention)
	return b.Bytes(), nil
}
