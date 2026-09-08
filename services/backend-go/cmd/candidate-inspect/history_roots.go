package main

import (
	"errors"
	"strconv"
	"tickergarden/backend/internal/readmodel"
)

func requireCandidateHistoryRoots(c readmodel.CandidateSet) error {
	end, err := strconv.ParseUint(c.BlockNumber, 10, 64)
	if err != nil || c.BlockNumber != strconv.FormatUint(end, 10) || c.HistoryStartBlock > end || !c.HasVerifiedHistory() {
		return errors.New("candidate history receipt roots not verified")
	}
	return nil
}
