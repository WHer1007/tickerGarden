package main

import (
	"testing"
	"tickergarden/backend/internal/readmodel"
)

func TestRequireCandidateHistoryRoots(t *testing.T) {
	for _, c := range []readmodel.CandidateSet{
		{BlockNumber: "0x3", HistoryStartBlock: 1},
		{BlockNumber: "0x3", HistoryStartBlock: 1, HistoryReceiptRootsVerified: true},
		{BlockNumber: "3", HistoryStartBlock: 4, HistoryReceiptRootsVerified: true},
		{BlockNumber: "03", HistoryStartBlock: 1, HistoryReceiptRootsVerified: true},
	} {
		if requireCandidateHistoryRoots(c) == nil {
			t.Fatal("accepted missing or invalid range evidence", c)
		}
	}
	if err := requireCandidateHistoryRoots(readmodel.CandidateSet{BlockNumber: "3", HistoryStartBlock: 1, HistoryReceiptRootsVerified: true}); err != nil {
		t.Fatal(err)
	}
}
