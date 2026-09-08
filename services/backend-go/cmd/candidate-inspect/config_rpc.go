package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strconv"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func verifyCandidateConfigs(ctx context.Context, rpc deployment.BindingObserver, m deployment.Manifest, c readmodel.CandidateSet) error {
	bad := errors.New("candidate configuration RPC mismatch")
	if len(c.Configs) > 4096 {
		return bad
	}
	n, e := readmodel.Height(c.BlockNumber)
	if e != nil {
		return bad
	}
	block, e := rpc.Header(ctx, "0x"+strconv.FormatUint(n, 16))
	if e != nil || block.Hash != c.BlockHash {
		return bad
	}
	configs := []readmodel.ConfigReadModel{}
	seen := map[string]bool{}
	for _, config := range c.Configs {
		if config.Kind == "asset" {
			continue
		}
		if config.Kind != "quote" && config.Kind != "baseline" && config.Kind != "template" {
			return bad
		}
		key := config.Kind + ":" + config.ID
		if seen[key] {
			return bad
		}
		seen[key] = true
		configs = append(configs, config)
	}
	for start := 0; start < len(configs); start += deployment.MaxConfigReads {
		end := start + deployment.MaxConfigReads
		if end > len(configs) {
			end = len(configs)
		}
		targets := []deployment.ConfigTarget{}
		for _, config := range configs[start:end] {
			targets = append(targets, deployment.ConfigTarget{Kind: config.Kind, ID: config.ID})
		}
		batch, e := deployment.ObserveConfigBlock(ctx, rpc, m, block, targets)
		if e != nil || batch.ChainID != c.ChainID || batch.BlockNumber != block.Number || batch.BlockHash != c.BlockHash || matchCandidateConfigs(configs[start:end], batch) != nil {
			return bad
		}
	}
	return nil
}

func matchCandidateConfigs(configs []readmodel.ConfigReadModel, b deployment.ObservationBatch) error {
	bad := errors.New("candidate configuration values differ from RPC")
	if b.Scope != deployment.ConfigObservationScope || b.Expected != len(configs) || len(b.Observations) != len(configs) {
		return bad
	}
	seen := map[string]bool{}
	for _, config := range configs {
		key := config.Kind + ":" + config.ID
		if seen[key] {
			return bad
		}
		seen[key] = true
		expected, e := readmodel.BuildConfigCandidate(b, config.Kind, config.ID, config.Source)
		if e != nil || expected.Status != config.Status {
			return bad
		}
		left, e := json.Marshal(expected.Values)
		if e != nil {
			return bad
		}
		right, e := json.Marshal(config.Values)
		if e != nil || !bytes.Equal(left, right) {
			return bad
		}
	}
	return nil
}
