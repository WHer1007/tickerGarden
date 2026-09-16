package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/projector"
	"tickergarden/backend/internal/readmodel"
)

func enrichAccounts(ctx context.Context, pool *pgxpool.Pool, chainID uint64, data []byte) ([]byte, error) {
	startText := os.Getenv("TG_PROJECTION_START_BLOCK")
	start, err := strconv.ParseUint(startText, 10, 63)
	if err != nil || strconv.FormatUint(start, 10) != startText {
		return nil, errors.New("TG_PROJECTION_START_BLOCK must be a canonical nonnegative integer")
	}
	file, err := os.Open(os.Getenv("TG_DEPLOYMENT_MANIFEST"))
	if err != nil {
		return nil, errors.New("cannot open TG_DEPLOYMENT_MANIFEST")
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if err != nil {
		return nil, err
	}
	manifest, err := deployment.Parse(raw)
	if err != nil || manifest.ChainID != chainID {
		return nil, errors.New("invalid account deployment manifest or chain")
	}
	sort.Slice(manifest.Contracts, func(i, j int) bool { return manifest.Contracts[i].Address < manifest.Contracts[j].Address })
	canonical, err := json.Marshal(manifest)
	if err != nil {
		return nil, err
	}
	store := readmodel.ObservationStore{EmitterManifest: &manifest, Pool: pool, ChainID: chainID, GenesisHash: manifest.GenesisHash, ManifestHash: deployment.Hash(canonical), Version: projector.Version, Scope: projector.ObservationScope, StartBlock: start}
	return store.EnrichAccounts(ctx, data)
}
