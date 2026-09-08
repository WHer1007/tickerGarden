package main

import (
	"errors"
	"reflect"
	"strconv"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
)

func matchCandidateHolders(c readmodel.CandidateSet, b deployment.ObservationBatch) error {
	bad := errors.New("candidate Holder state differs from RPC")
	height, e := readmodel.Height(c.BlockNumber)
	if e != nil || b.ChainID != c.ChainID || b.BlockHash != c.BlockHash || b.BlockNumber != "0x"+strconv.FormatUint(height, 16) || b.Scope != "known-holder-coverage-v1" || b.Expected != len(b.Observations) {
		return bad
	}
	markets := map[string]readmodel.MarketReadModel{}
	for _, m := range c.Markets {
		if _, ok := markets[m.MarketID]; ok {
			return bad
		}
		markets[m.MarketID] = m
	}
	expected, e := readmodel.BuildHolderCandidates(b, markets)
	if e != nil || len(expected) != len(c.HolderMarkets) {
		return bad
	}
	for i := range expected {
		if !reflect.DeepEqual(expected[i], c.HolderMarkets[i]) {
			return bad
		}
	}
	return nil
}
