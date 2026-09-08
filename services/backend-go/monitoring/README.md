# API monitoring

This is a host-process example, not a deployed monitoring service. `prometheus.yml` scrapes the API at 127.0.0.1:8790 and uses a separately running blackbox exporter at 127.0.0.1:9115 to call /readyz every 15 seconds. Configure the exporter with blackbox.yml. Change both addresses for your deployment topology; container localhost refers to the container itself.

The /metrics endpoint does not refresh readiness. Without the blackbox probe (or another independent GET /readyz probe), the readiness timestamp becomes stale and raises an alert. A 503 readiness response is expected until a valid published snapshot and database are available. It does not mean the API process has crashed.

Validate from services/backend-go:

```sh
make monitoring-check monitoring-integration-check PROMTOOL=/absolute/path/to/promtool
```

Validated with official Prometheus promtool 3.14.0 (download checksum verified). `promtool` validates Prometheus configuration and alert rules; it does not validate or start the blackbox exporter. No receiver, email, chat, or production host is configured here.

Initial thresholds, to tune against measured traffic:

| Alert | Trigger | Hold |
| --- | --- | --- |
| APIDown | Metrics scrape fails | 2 minutes |
| ReadinessMetricsMissing | Scrape succeeds but either readiness metric is absent | 2 minutes |
| ReadinessClockSkew | Observation time over 30 seconds ahead of collector time | 2 minutes |
| ReadinessStale | Last readiness observation over 120 seconds old | 2 minutes |
| NotReady | Fresh readiness reports 0 | 2 minutes |
| APIErrorRate | Business request 5xx ratio over 5%, traffic over 1 request/second | 5 minutes |
| APILatency | Business request p95 over 1 second, traffic over 1 request/second | 5 minutes |

Health/probe routes are excluded from error and latency aggregates. Request counters reset on process restart; rate() handles resets. Readiness uses the newest-started completed probe and must be evaluated together with observation age.

On an alert, first inspect /livez and /readyz, then the API logs, database reachability and published snapshot freshness. Do not force readiness or publish an unchecked candidate to silence an alert. Add deployment-specific Alertmanager routing and verify notification delivery separately; these files do not send notifications.

Missing-readiness checks match each job/instance independently and only run for successful API scrapes; a down instance is covered by APIDown. A future observation timestamp raises ClockSkew instead of silently appearing fresh forever. Restore required metrics or correct host/collector time synchronization, then verify the alert resolves.

`monitoring-integration-check` starts an ephemeral local HTTP API with controlled readiness dependencies, requests real /readyz and /metrics endpoints, and pipes each response into promtool check metrics. It verifies startup, failure and recovery output without requiring PostgreSQL, a Prometheus daemon or production access. It does not verify remote scraping or notification delivery.

Validate the actual Blackbox Exporter process and supplied configuration:

```sh
make monitoring-probe-check BLACKBOX_EXPORTER=/absolute/path/to/blackbox_exporter
```

Validated with official Blackbox Exporter 0.28.0 (release SHA-256 verified). This test starts an exporter bound to a temporary loopback port, loads blackbox.yml and probes a local API through failure/recovery transitions. It checks probe_success, probe_http_status_code and the API readiness metric, then terminates the process. It does not start a permanent monitoring service or test Alertmanager delivery.

Validate the complete local scrape path:

```sh
make monitoring-stack-check PROMETHEUS=/absolute/path/to/prometheus BLACKBOX_EXPORTER=/absolute/path/to/blackbox_exporter
```

This starts real Prometheus and Blackbox Exporter processes with temporary loopback ports and TSDB storage. A temporary copy of prometheus.yml replaces targets with test addresses and shortens scrape/evaluation intervals; the source config and alert thresholds are unchanged. The test queries Prometheus for API up, probe_success and API readiness across four failure/recovery transitions, and verifies all seven alert rules load healthy. All processes and temporary storage are cleaned up. Alert timing is covered separately by promtool; production routing and notification delivery remain deployment acceptance tasks.

Pipeline status can be handed to an existing textfile collector using `backend-status --once --metrics-file /absolute/collector/pipeline.prom`. See the backend README for configuration. The command atomically replaces the file for complete reports (exit 0 or 2), preserves the previous file on inspection failure (exit 1), and emits nothing to stdout. Use one writer per file and alert on absent, old or future `tickergarden_pipeline_observed_timestamp_seconds`; a retained file is not proof that the latest run succeeded. The optional pipeline freshness rules below are available; a textfile collector scrape target is not configured by default.

Optional pipeline textfile alerts are in `pipeline-alerts.yml`; `make monitoring-check` validates them and their nine time-series scenarios. Enable this rule file only when configuring the pipeline collector. Add it to Prometheus `rule_files` and use scrape job name `tickergarden-pipeline` for the collector that exposes the backend-status textfile. The existing default config continues to monitor the API only; no collector or scheduler is installed by these files.

Rules wait two minutes before firing: collector down; successful scrape missing timestamp or attention metrics; report older than five minutes; timestamp more than 30 seconds in the future; fresh attention=1 with a successful scrape. Attention requires matching job/instance/chain_id timestamps, so an old or future-dated file cannot be treated as current evidence. Missing-metric detection is per collector instance; configure one intended chain per instance, or add explicit expected-chain inventory rules before combining multiple chains. Neither these rules nor a green scrape proves production readiness or complete financial reconciliation. The five-minute freshness threshold assumes a collection cadence shorter than five minutes and must be tuned to the actual scheduler; exit 1 must not refresh the stored observation timestamp.

Tests cover offline, absent timestamp, absent attention, both absent, retained stale file, future clock, active attention/recovery, healthy state and per-instance isolation. They verify rule evaluation only, not production scrape routing or external notification delivery.


回执根补验监控：backend-status 的 `receiptRootMissing` 是当前链 canonical 已存区块中缺少 `receipts_root` 的数量；无有效 journal tip 时为 null。Prometheus 对应 `tickergarden_pipeline_receipt_root_missing_blocks`，未知时不输出，不能当作零。大于零产生 `receipt_root_backfill_pending`，未知产生 `receipt_root_coverage_unknown`，通过现有 pipeline attention 告警规则上报。补验归零仅说明已存区块的此类缺项已清除，不证明全链历史覆盖或生产就绪。
