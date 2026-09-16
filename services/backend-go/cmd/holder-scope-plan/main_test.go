package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"tickergarden/backend/internal/holderledger"
	"tickergarden/backend/internal/holderplan"
)

func outputFixture() holderplan.Plan {
	market := "0x" + strings.Repeat("1", 64)
	scope := holderledger.CheckpointScope{MarketID: market, Token: "0x" + strings.Repeat("2", 40)}
	return holderplan.Plan{Version: 1, Items: []holderplan.Item{{MarketID: market, Scope: scope, Seed: holderplan.SeedRequest{BlockNumber: "0xa"}}}}
}

func TestOutputShapesAreDirectlyConsumable(t *testing.T) {
	plan := outputFixture()
	var scopes bytes.Buffer
	if err := output(plan, []string{"--scopes"}, &scopes); err != nil {
		t.Fatal(err)
	}
	var decoded []holderledger.CheckpointScope
	if json.Unmarshal(scopes.Bytes(), &decoded) != nil || len(decoded) != 1 || decoded[0] != plan.Items[0].Scope {
		t.Fatalf("invalid scopes output: %s", scopes.String())
	}
	var seed bytes.Buffer
	if err := output(plan, []string{"--seed-request", plan.Items[0].MarketID}, &seed); err != nil {
		t.Fatal(err)
	}
	var request holderplan.SeedRequest
	if json.Unmarshal(seed.Bytes(), &request) != nil || request.BlockNumber != "0xa" {
		t.Fatalf("invalid seed output: %s", seed.String())
	}
	if err := output(plan, []string{"--seed-request", "0x" + strings.Repeat("f", 64)}, &seed); err == nil {
		t.Fatal("missing market seed accepted")
	}
}

func TestDescribeNeedsNoEnvironment(t *testing.T) {
	var out bytes.Buffer
	if err := run(t.Context(), []string{"--describe"}, func(string) string { return "" }, &out); err != nil || !strings.Contains(out.String(), `"readOnly":true`) {
		t.Fatalf("describe failed: %v %s", err, out.String())
	}
}
