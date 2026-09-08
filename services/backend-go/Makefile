GO ?= go

# Start configured services with tools/environment.mjs; no per-service env file.
# Match the root Foundry launcher when the standard install is outside PATH.
FORGE ?= $(shell command -v forge 2>/dev/null || printf '%s' "$(HOME)/.foundry/bin/forge")
export

.PHONY: help run index-once index-run discover-once discover-run project-once project-run activity-backfill-once activity-backfill-run holder-scope-plan holder-scopes holder-seed-request holder-scope-public-check holder-replay-public-check holder-seed holder-replay-once holder-replay-run holder-replay-audit holder-checkpoint-check build test integration smoke smoke-chain smoke-gauge smoke-vault smoke-holder treasury-solidity-check contract-check vet fmt fmt-check verify migrate-status migrate-up db-up db-down

help:
	@printf '%s\n' 'run index-once index-run discover-once discover-run project-once project-run activity-backfill-once activity-backfill-run holder-scope-plan holder-scopes holder-seed-request holder-scope-public-check holder-replay-public-check holder-seed holder-replay-once holder-replay-run holder-checkpoint-check build test integration smoke smoke-chain smoke-gauge smoke-vault smoke-holder treasury-solidity-check contract-check vet fmt verify migrate-status migrate-up db-up db-down monitoring-check monitoring-integration-check monitoring-probe-check monitoring-stack-check'

holder-scope-plan:
	$(GO) run ./cmd/holder-scope-plan --once

holder-scopes:
	$(GO) run ./cmd/holder-scope-plan --scopes

holder-seed-request:
	@test -n "$(MARKET_ID)" || (echo 'MARKET_ID is required' >&2; exit 1)
	$(GO) run ./cmd/holder-scope-plan --seed-request "$(MARKET_ID)"

holder-scope-public-check:
	@test -n "$$ARBITRUM_SEPOLIA_RPC_URL" || (echo 'ARBITRUM_SEPOLIA_RPC_URL is required' >&2; exit 1)
	@test -n "$$TG_TEST_DATABASE_URL" || (echo 'TG_TEST_DATABASE_URL is required (local PostgreSQL with CREATEDB)' >&2; exit 1)
	TG_TEST_HOLDER_SCOPE_PUBLIC=1 $(GO) test -race ./integration -run '^TestHolderScopePlanAgainstArbitrumSepolia$$' -count=1 -v

holder-replay-public-check:
	@test -n "$$ARBITRUM_SEPOLIA_RPC_URL" || (echo 'ARBITRUM_SEPOLIA_RPC_URL is required' >&2; exit 1)
	@test -n "$$TG_TEST_DATABASE_URL" || (echo 'TG_TEST_DATABASE_URL is required (local PostgreSQL with CREATEDB)' >&2; exit 1)
	TG_TEST_HOLDER_SCOPE_PUBLIC=1 TG_TEST_HOLDER_REPLAY_PUBLIC=1 $(GO) test -race ./integration -run '^TestHolderScopePlanAgainstArbitrumSepolia$$' -count=1 -v

holder-seed:
	@test -n "$(REQUEST)" || (echo 'REQUEST is required' >&2; exit 1)
	$(GO) run ./cmd/holder-seed --initialize "$(REQUEST)"

holder-replay-once:
	@test -n "$(SCOPE)" || (echo 'SCOPE is required' >&2; exit 1)
	$(GO) run ./cmd/holder-replay-worker --once "$(SCOPE)"

holder-replay-run:
	@test -n "$(SCOPE)" || (echo 'SCOPE is required' >&2; exit 1)
	$(GO) run ./cmd/holder-replay-worker --run "$(SCOPE)"

holder-replay-audit:
	@test -n "$(SCOPE)" || (echo 'SCOPE is required' >&2; exit 1)
	$(GO) run ./cmd/holder-replay-worker --audit "$(SCOPE)"

holder-checkpoint-check:
	GOMAXPROCS=2 GOFLAGS=-p=2 python3 scripts/verify_holder_checkpoints.py

project-once:
	$(GO) run ./cmd/projection-worker --once

project-run:
	$(GO) run ./cmd/projection-worker --run

activity-backfill-once:
	$(GO) run ./cmd/projection-worker --backfill-activity-once

activity-backfill-run:
	$(GO) run ./cmd/projection-worker --backfill-activity-run

discover-once:
	$(GO) run ./cmd/discovery-worker --once

discover-run:
	$(GO) run ./cmd/discovery-worker --run

index-once:
	$(GO) run ./cmd/indexer --once

index-run:
	$(GO) run ./cmd/indexer --run

run:
	$(GO) run ./cmd/api

build:
	@mkdir -p bin
	$(GO) build -trimpath -o ./bin/ ./cmd/...

test:
	$(GO) test -race ./...

integration:
	@test -n "$$TG_TEST_DATABASE_URL" || (echo 'TG_TEST_DATABASE_URL is required (local PostgreSQL with CREATEDB)' >&2; exit 1)
	$(GO) test -race -count=1 -v ./integration

smoke: build
	python3 scripts/smoke_local.py

smoke-chain: build
	TG_SMOKE_CHAIN=1 python3 scripts/smoke_local.py

smoke-gauge: build
	TG_SMOKE_CHAIN=1 TG_SMOKE_STAKING=1 python3 scripts/smoke_local.py

smoke-vault: build
	TG_SMOKE_CHAIN=1 TG_SMOKE_VAULT=1 python3 scripts/smoke_local.py

smoke-holder: build
	TG_SMOKE_CHAIN=1 TG_SMOKE_HOLDER=1 python3 scripts/smoke_local.py

vet:
	$(GO) vet ./...

fmt:
	$(GO) fmt ./...

fmt-check:
	@test -z "$$(gofmt -l $$(find . -name '*.go' -not -path './bin/*'))" || (echo 'Run make fmt' >&2; exit 1)

contract-check:
	node scripts/generate-openapi.mjs --check
	node scripts/generate-v1-events.mjs --check
	node --experimental-strip-types --test testsupport/*.test.ts testsupport/*.test.mjs
	python3 scripts/generate_gauge_storage.py --check
	python3 scripts/generate_settlement_storage.py --check
	python3 scripts/generate_events.py --check
	python3 scripts/generate_models.py --check
	node --experimental-strip-types scripts/generate_api_golden.mjs --check
	node --experimental-strip-types scripts/generate_projection_golden.mjs --check
	node --experimental-strip-types scripts/generate_treasury_golden.mjs --check
	node --experimental-strip-types scripts/generate_settlement_golden.mjs --check

treasury-solidity-check:
	python3 scripts/verify_treasury_solidity.py

.PHONY: holder-ledger-solidity-check
holder-ledger-solidity-check:
	python3 scripts/verify_holder_ledger_solidity.py

.PHONY: gauge-solidity-check
gauge-solidity-check:
	python3 scripts/verify_gauge_position_solidity.py

verify: fmt-check vet test build

.PHONY: financial-publication-check
financial-publication-check:
	python3 scripts/verify_financial_publication.py

migrate-status:
	$(GO) run ./cmd/migrate status

migrate-up:
	$(GO) run ./cmd/migrate up

db-up:
	docker compose up -d postgres

db-down:
	docker compose stop postgres

.PHONY: smoke-settlement
smoke-settlement: build
	python3 scripts/smoke_settlement.py

.PHONY: conversion-solidity-check
conversion-solidity-check:
	python3 scripts/verify_conversion_pool_solidity.py

.PHONY: smoke-execution-evidence
smoke-execution-evidence:
	python3 scripts/smoke_execution_evidence.py
	python3 scripts/smoke_execution_evidence.py --native
	python3 scripts/smoke_execution_evidence.py --staker
	python3 scripts/smoke_execution_evidence.py --staker --native
	python3 scripts/smoke_execution_evidence.py --staker --mature
	python3 scripts/smoke_execution_evidence.py --staker --mature --native

.PHONY: candidate-inspect
candidate-inspect:
	go run ./cmd/candidate-inspect --once

PROMTOOL ?= promtool
.PHONY: monitoring-check
monitoring-check:
	cd monitoring && $(PROMTOOL) check config prometheus.yml && $(PROMTOOL) check rules pipeline-alerts.yml && $(PROMTOOL) test rules alerts.test.yml pipeline-alerts.test.yml

.PHONY: monitoring-integration-check
monitoring-integration-check:
	TG_TEST_PROMTOOL="$(PROMTOOL)" $(GO) test -race ./integration -run '^TestMetricsPrometheusCompatibility$$' -count=1

BLACKBOX_EXPORTER ?= blackbox_exporter
.PHONY: monitoring-probe-check
monitoring-probe-check:
	TG_TEST_BLACKBOX="$(BLACKBOX_EXPORTER)" $(GO) test -race ./integration -run '^TestBlackboxReadinessIntegration$$' -count=1

PROMETHEUS ?= prometheus
.PHONY: monitoring-stack-check
monitoring-stack-check:
	TG_TEST_PROMETHEUS="$(PROMETHEUS)" TG_TEST_BLACKBOX="$(BLACKBOX_EXPORTER)" $(GO) test -race ./integration -run '^TestMonitoringStack$$' -count=1
