package integration

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/holderledger"
	"tickergarden/backend/internal/holderplan"
	"tickergarden/backend/internal/migration"
	"tickergarden/backend/internal/postgres"
	"tickergarden/backend/internal/readmodel"
)

// This opt-in test is read-only. It validates the planner against the active
// Arbitrum Sepolia continuous-Holder release and three published test markets.
func TestHolderScopePlanAgainstArbitrumSepolia(t *testing.T) {
	if os.Getenv("TG_TEST_HOLDER_SCOPE_PUBLIC") != "1" {
		t.Skip("set TG_TEST_HOLDER_SCOPE_PUBLIC=1, ARBITRUM_SEPOLIA_RPC_URL and TG_TEST_DATABASE_URL")
	}
	dsn := os.Getenv("TG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TG_TEST_DATABASE_URL is required for disposable checkpoint verification")
	}
	rpc, err := chainrpc.New(os.Getenv("ARBITRUM_SEPOLIA_RPC_URL"))
	if err != nil {
		t.Fatal("Arbitrum Sepolia RPC unavailable")
	}
	finalized, err := rpc.Header(t.Context(), "finalized")
	if err != nil {
		t.Fatal("cannot read finalized Arbitrum Sepolia header")
	}
	height, err := finalized.Height()
	if err != nil {
		t.Fatal(err)
	}
	manifest := deployment.Manifest{ExecutionSpecID: "V1-EXEC-11", ChainID: 421614, GenesisHash: "0x77194da4010e549a7028a9c3c51c3e277823be6ac7d138d0bb8a70197b5c004c", Contracts: []deployment.Contract{
		{Module: "TickerGardenFactoryV1", Address: "0xca33ad42a9ad0a4325d6b2118143a242dc843fe3", RuntimeCodeHash: "0x1edb17d58762bd6024213f89a7db97bb80d8f086f9d32a450863f17d415425c3"},
		{Module: "ProtocolFeeVault", Address: "0x381ecdd457c642a10e63f068004c9e4d27d7315f", RuntimeCodeHash: "0x53fbcd7a77749fb1485b88c091482c1a5b5d04c1c4cba4d4fcf9f3096a24ffad"},
		{Module: "HolderRewardsDistributorV1", Address: "0xe7d8ccb1fe0947ba4a260a6c68319e99e4f6646a", RuntimeCodeHash: "0x8e20881268889a0e02a267507857a27cfbabf06c4c58e1d2a59e477339804458"},
	}}
	type publicMarket struct{ id, token, quote, block, hash string }
	rows := []publicMarket{
		{"0x25be8c43a03945e6c67612dff4bd452ea4fe6ed958f6a14f9a17133ce04717c7", "0x3ece0d39c5cc1c0df677e3847e8f3392df989d4a", "0x0000000000000000000000000000000000000000", "306129106", "0x70c5656bf619d14c8d9ed3928a5181d8ef2a18ebdb004de6c2b0fc2ebcba6143"},
		{"0xe28955559da4776037528e6c59f7f9f53283e8c09d940721d5ba9d836468e344", "0xd7e055918ab6e2f541c2805b5c19f36c525712c7", "0xe0a2d51b7a627934b7fdce972744007dd00f8a97", "306129762", "0x472727ab8ec15acc0244661994e0e2094a9551f702aa1d98029c44f65f5bfcb1"},
		{"0x09e93674eb33b034fca0e7a62ce77d0818f78f98186c87e704ba201b06458332", "0xe1d616a72e8b4e609b833abdfbbb05d3fd7f1c6e", "0xe0a2d51b7a627934b7fdce972744007dd00f8a97", "306129960", "0xa7414283d8d8f58896c79a1e6888ad365ec2413014d5197e8e9fb5efbb3f5366"},
	}
	candidate := readmodel.CandidateSet{ChainID: manifest.ChainID, BlockNumber: strconv.FormatUint(height, 10), BlockHash: finalized.Hash, Markets: []readmodel.MarketReadModel{}, HolderMarkets: []readmodel.HolderMarketCandidate{}}
	for _, row := range rows {
		candidate.Markets = append(candidate.Markets, readmodel.MarketReadModel{MarketID: row.id, MemeToken: row.token, QuoteAsset: row.quote, Source: readmodel.SourceBlock{ChainID: manifest.ChainID, BlockNumber: row.block, BlockHash: row.hash}})
		candidate.HolderMarkets = append(candidate.HolderMarkets, readmodel.HolderMarketCandidate{MarketID: row.id, Distributor: manifest.Contracts[2].Address, MemeToken: row.token, QuoteAsset: row.quote, Mode: "continuous-24h", Continuous: &readmodel.ContinuousHolderCandidate{}})
	}
	plan, err := holderplan.Build(t.Context(), rpc, manifest, candidate, 10000)
	if err != nil || len(plan.Items) != len(rows) {
		t.Fatalf("public holder scope plan failed: items=%d err=%v", len(plan.Items), err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Minute)
	defer cancel()
	adminConfig, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid test database URL")
	}
	admin, err := pgx.ConnectConfig(ctx, adminConfig)
	if err != nil {
		t.Fatal("cannot connect to test PostgreSQL")
	}
	defer admin.Close(context.Background())
	name := fmt.Sprintf("tg_holder_public_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		t.Fatal("cannot create disposable holder database")
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 15*time.Second)
		defer stop()
		if _, dropErr := admin.Exec(cleanup, "DROP DATABASE "+identifier+" WITH (FORCE)"); dropErr != nil {
			t.Error("cannot remove disposable holder database")
		}
	}()
	testConfig := adminConfig.Copy()
	testConfig.Database = name
	db := stdlib.OpenDB(*testConfig)
	provider, err := migration.New(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = provider.Up(ctx); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	testURL, err := url.Parse(dsn)
	if err != nil || testURL.Scheme != "postgres" && testURL.Scheme != "postgresql" {
		t.Fatal("test database URL must use postgres scheme")
	}
	testURL.Path = "/" + name
	pool, err := postgres.Open(ctx, testURL.String(), 3)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := holderledger.CheckpointStore{Pool: pool}
	verifiedRPC := chainrpc.RootVerifiedClient{Client: rpc}
	for _, item := range plan.Items {
		if item.Seed.Seed.Scope != item.Scope || item.Seed.BlockNumber == "" || item.Scope.Config.TokenCodeHash == "" {
			t.Fatalf("incomplete public scope: %+v", item)
		}
		block, headerErr := rpc.Header(t.Context(), item.Seed.BlockNumber)
		if headerErr != nil {
			t.Fatalf("cannot read seed block for %s: %v", item.MarketID, headerErr)
		}
		ledger, report, evidence, seedErr := holderledger.AuthenticatePristineSeedWithEvidence(ctx, verifiedRPC, item.Seed.Seed, block)
		if seedErr != nil || ledger == nil || report.Block != block || evidence.Block != block || report.RegistrationTx == "" || report.Transfers < 1 || report.Accounts < 1 {
			t.Fatalf("public seed authentication failed for %s: report=%+v err=%v", item.MarketID, report, seedErr)
		}
		if err := store.InitializeAuthenticatedEvidence(ctx, item.Scope, block, ledger, report, evidence); err != nil {
			t.Fatalf("cannot persist authenticated public seed for %s: %v", item.MarketID, err)
		}
		wantRevisions := int64(1)
		wantHead := block
		if os.Getenv("TG_TEST_HOLDER_REPLAY_PUBLIC") == "1" {
			n, _ := block.Height()
			next, headerErr := rpc.Header(ctx, fmt.Sprintf("0x%x", n+1))
			if headerErr != nil {
				t.Fatalf("cannot read first replay block for %s: %v", item.MarketID, headerErr)
			}
			if _, advanceErr := store.Advance(ctx, verifiedRPC, item.Scope, next); advanceErr != nil {
				t.Fatalf("cannot replay first public block for %s: %v", item.MarketID, advanceErr)
			}
			wantRevisions, wantHead = 2, next
		}
		audit, audited, auditErr := store.AuditHistory(ctx, item.Scope)
		if auditErr != nil || audited == nil || audit.Revisions != wantRevisions || !audit.AuthenticatedSeed || !audit.RawRootsReverified || !audit.EvidenceReplayValid || audit.Head != wantHead {
			t.Fatalf("public checkpoint audit failed for %s: audit=%+v err=%v", item.MarketID, audit, auditErr)
		}
	}
}
