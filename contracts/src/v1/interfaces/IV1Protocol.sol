// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// GENERATED FILE. DO NOT EDIT.
// Source: spec/v1_abi_surface.json (V1-EXEC-11)
// forge-lint: disable-start(multi-contract-file)
// forgefmt: disable-start

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

struct AssetView {
    address stockToken;
    address userStockVault;
    uint8 tokenDecimals;
    uint8 status;
}

struct StockTokenFingerprint {
    bytes32 tokenRuntimeCodeHash;
    address beacon;
    bytes32 beaconRuntimeCodeHash;
    address implementation;
    bytes32 implementationRuntimeCodeHash;
}

struct QuoteAssetConfig {
    bytes32 tickerGardenBaselineId;
    address quoteAsset;
    uint8 quoteDecimals;
    uint256 phantomQuote;
    uint256 graduationThreshold;
    bytes32 economicsHash;
    uint8 status;
}

struct StockQuoteBinding {
    bytes32 assetUid;
    bytes32 stockTokenFingerprintHash;
    bytes32 referenceEvidenceHash;
    bytes32 generatorPolicyId;
}

struct TickerGardenBaseline {
    uint256 referenceChainId;
    address referenceFactory;
    bytes32 referenceFactoryCodeHash;
    uint256 launchConfigId;
    uint256 supply;
    uint256 curveFeeBps;
    uint24 poolFee;
    int24 tickSpacing;
    bytes32 behaviorVectorRoot;
    uint8 status;
}

struct LaunchTemplate {
    address memeTokenImplementation;
    bytes32 memeTokenCodeHash;
    address curveImplementation;
    bytes32 curveCodeHash;
    address gaugeImplementation;
    bytes32 gaugeCodeHash;
    address graduatedHook;
    bytes32 hookCodeHash;
    address graduationExecutor;
    bytes32 graduationExecutorCodeHash;
    bytes32 feePolicyId;
    bytes32 executionSpecId;
    uint8 status;
}

struct CreateMarketParams {
    bytes32 assetUid;
    bytes32 tickerGardenBaselineId;
    bytes32 quoteAssetConfigId;
    bytes32 launchTemplateId;
    bytes32 expectedEconomics;
    address creatorRevenueBeneficiary;
    string name;
    string symbol;
    string metadataURI;
    bytes32 salt;
    uint16 creatorTaxBps;
    bool creatorFeesToHolders;
    bool stakingEnabled;
}

struct MarketConfig {
    bytes32 assetUid;
    bytes32 tickerGardenBaselineId;
    bytes32 quoteAssetConfigId;
    bytes32 launchTemplateId;
    bytes32 feePolicyId;
    bytes32 executionSpecId;
    bytes32 expectedEconomics;
    uint256 launchConfigId;
    address creatorRevenueBeneficiaryAtCreation;
    address memeToken;
    address curve;
    address gauge;
    address quoteAsset;
    address graduatedHook;
    uint16 creatorTaxBps;
    bool creatorFeesToHolders;
    bool stakingEnabled;
}

struct MarketRuntime {
    bytes32 poolId;
    uint32 sourceVersion;
    uint8 launchPhase;
}

struct MarketView {
    MarketConfig config;
    MarketRuntime runtime;
}

struct CanonicalRoute {
    PoolKey poolKey;
    bytes32 poolId;
    address swapRouter;
    address quoter;
    address hook;
    address quoteAsset;
    address memeToken;
    address gauge;
    address curve;
    address launchLocker;
    uint32 sourceVersion;
    uint8 launchPhase;
    bool curveTradingEnabled;
    bool poolTradingEnabled;
}

struct GaugeIdentity {
    bytes32 marketId;
    bytes32 assetUid;
    bytes32 quoteAssetConfigId;
    address allocationManager;
    address protocolFeeVault;
    address quoteAsset;
    address memeToken;
}

struct PositionView {
    uint256 activeAmount;
    uint256 pendingAmount;
    uint64 pendingGeneration;
    uint64 unlockAt;
    uint256 quoteClaimable;
    uint256 memeClaimable;
}

struct ActivationSlot {
    uint64 generation;
    uint256 amount;
    uint256 refs;
}

struct ActivationSnapshot {
    uint256 quoteAccumulator;
    uint256 memeAccumulator;
    uint256 refs;
    bool processed;
}

struct RewardStateView {
    uint256 accFeePerShare;
    uint256 indexRemainder;
}

struct PoolBinding {
    bytes32 marketId;
    bytes32 keyHash;
    uint32 sourceVersion;
    uint64 feeNonce;
    uint8 status;
}

enum BucketType {
    CREATOR_REVENUE,
    STAKER_REWARD,
    PLATFORM_REVENUE
}

interface IV1Errors {
    error InvalidLaunchFee(uint256 arg0, uint256 arg1);
    error TemplateCodeHashMismatch(address arg0, bytes32 arg1, bytes32 arg2);
    error UnauthorizedMarketCurve(address arg0, address arg1);
    error CurveFeeSweepAfterClose(bytes32 arg0);
    error LaunchLockerAddressCollision(address arg0);
    error InvalidCanonicalPoolKey();
    error InvalidHookPermissionMask();
    error PoolNotExpected(bytes32 arg0);
    error PoolBindingNotActive(bytes32 arg0);
    error InactiveFeeSource(bytes32 arg0, uint32 arg1);
    error NonZeroCoreFee(uint24 arg0, uint24 arg1);
    error FeeAmountTooLarge(uint256 arg0);
    error FeeAssetNotCanonical(address arg0);
    error FeeIdAlreadyConsumed(bytes32 arg0);
    error FeeCreditNotPrepared(bytes32 arg0);
    error FeeBalanceDeltaMismatch(address arg0, uint256 arg1, uint256 arg2);
    error InexactFeePayment(address arg0, address arg1, uint256 arg2, uint256 arg3, uint256 arg4);
    error ActivationSlotCollision(uint8 arg0, uint64 arg1, uint64 arg2);
    error PendingGenerationNotFound(uint64 arg0);
    error InvalidMinimumAllocation(bytes32 arg0, uint256 arg1);
    error AssetNotRegistered(bytes32 arg0);
    error AssetIdentityDrift(bytes32 arg0);
    error UnmonitoredDelegateProxy(address arg0);
    error InvalidAssetMinimumAllocation(bytes32 arg0, uint256 arg1);
    error PositionBelowMinimum(uint256 arg0, uint256 arg1);
    error PositionLockedUntil(uint64 arg0);
    error InvalidRageQuitAmount(uint256 arg0, uint256 arg1);
    error InvalidRageQuitUser(address arg0);
    error NoRageQuitPosition(address arg0);
    error RageQuitRewardSettlementPending(address arg0, bytes32 arg1, uint256 arg2);
    error NoRageQuitRewardSettlement(address arg0, bytes32 arg1);
    error UnauthorizedForfeitureGauge(address arg0, address arg1);
    error InvalidForfeiture(address arg0, uint256 arg1, uint256 arg2);
    error AllocationExceedsDeposit(uint256 arg0, uint256 arg1);
    error AllocationLedgerMismatch();
    error StockAllocationClosed(bytes32 arg0);
    error InvalidStateTransition(uint8 arg0, uint8 arg1);
    error ArbitraryRecipientForbidden();
}

interface IOfficialStockRegistryV1 {
    event StockVaultRegistered(address indexed userStockVault, bytes32 indexed schemaId, address indexed marketRegistry, address allocationManager);
    event StockVaultCodeIdentityPinned(address indexed userStockVault, bytes32 indexed runtimeCodeHash);
    event AssetRegistered(bytes32 indexed assetUid, address indexed stockToken, address indexed userStockVault, uint8 tokenDecimals);
    event StockTokenFingerprintRegistered(bytes32 indexed assetUid, bytes32 indexed tokenRuntimeCodeHash, address indexed beacon, bytes32 beaconRuntimeCodeHash, address implementation, bytes32 implementationRuntimeCodeHash);
    event AssetImplementationAccepted(bytes32 indexed assetUid, address indexed oldImplementation, address indexed newImplementation, bytes32 oldImplementationRuntimeCodeHash, bytes32 newImplementationRuntimeCodeHash, bytes32 reasonHash);
    event AssetMinimumAllocationChanged(bytes32 indexed assetUid, uint256 oldMinimum, uint256 newMinimum, bytes32 reasonHash);
    event AssetStatusChanged(bytes32 indexed assetUid, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function registerAsset(bytes32 arg0, address arg1, uint8 arg2, address arg3, uint256 arg4, StockTokenFingerprint calldata arg5) external;
    function acceptAssetImplementation(bytes32 arg0, address arg1, bytes32 arg2, bytes32 arg3) external;
    function setMinimumAllocation(bytes32 arg0, uint256 arg1, bytes32 arg2) external;
    function pauseAsset(bytes32 arg0, bytes32 arg1) external;
    function unpauseAsset(bytes32 arg0) external;
    function retireAsset(bytes32 arg0, bytes32 arg1) external;
    function asset(bytes32 arg0) external view returns (AssetView memory output0);
    function assetFingerprint(bytes32 arg0) external view returns (StockTokenFingerprint memory output0);
    function assetIdentityCurrent(bytes32 arg0) external view returns (bool output0);
    function minimumAllocation(bytes32 arg0) external view returns (uint256 output0);
    function vaultSchemaId(address arg0) external view returns (bytes32 output0);
    function vaultForSchema(bytes32 arg0) external view returns (address output0);
    function vaultRuntimeCodeHash(address arg0) external view returns (bytes32 output0);
    function vaultIdentityCurrent(address arg0) external view returns (bool output0);
}

interface IApprovedQuoteRegistry {
    event QuoteAssetConfigAdded(bytes32 indexed configId, address indexed quoteAsset, bytes32 indexed tickerGardenBaselineId, bytes32 economicsHash);
    event QuoteAssetIdentityPinned(bytes32 indexed configId, address indexed quoteAsset, bytes32 runtimeCodeHash);
    event StockQuoteConfigBound(bytes32 indexed configId, bytes32 indexed assetUid, address indexed quoteAsset, bytes32 stockTokenFingerprintHash, bytes32 referenceEvidenceHash, bytes32 generatorPolicyId);
    event QuoteAssetStatusChanged(bytes32 indexed configId, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function addQuoteConfig(bytes32 arg0, QuoteAssetConfig calldata arg1) external;
    function addStockQuoteConfig(bytes32 arg0, QuoteAssetConfig calldata arg1, StockQuoteBinding calldata arg2) external;
    function pauseQuote(bytes32 arg0, bytes32 arg1) external;
    function unpauseQuote(bytes32 arg0) external;
    function retireQuote(bytes32 arg0, bytes32 arg1) external;
    function quoteConfig(bytes32 arg0) external view returns (QuoteAssetConfig memory output0);
    function stockQuoteBinding(bytes32 arg0) external view returns (StockQuoteBinding memory output0);
    function quoteRuntimeCodeHash(bytes32 arg0) external view returns (bytes32 output0);
    function quoteIdentityCurrent(bytes32 arg0) external view returns (bool output0);
    function officialStockRegistry() external view returns (address output0);
}

interface ITickerGardenBaselineRegistry {
    event TickerGardenBaselineAdded(bytes32 indexed baselineId, bytes32 indexed behaviorVectorRoot, bytes32 factoryCodeHash);
    event TickerGardenBaselineStatusChanged(bytes32 indexed baselineId, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function addBaseline(bytes32 arg0, TickerGardenBaseline calldata arg1) external;
    function pauseBaseline(bytes32 arg0, bytes32 arg1) external;
    function unpauseBaseline(bytes32 arg0) external;
    function retireBaseline(bytes32 arg0, bytes32 arg1) external;
    function baseline(bytes32 arg0) external view returns (TickerGardenBaseline memory output0);
}

interface ILaunchTemplateRegistry {
    event LaunchTemplateAdded(bytes32 indexed launchTemplateId, bytes32 indexed templateHash, bytes32 indexed executionSpecId);
    event LaunchTemplateStatusChanged(bytes32 indexed launchTemplateId, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function addLaunchTemplate(bytes32 arg0, LaunchTemplate calldata arg1) external;
    function pauseLaunchTemplate(bytes32 arg0, bytes32 arg1) external;
    function unpauseLaunchTemplate(bytes32 arg0) external;
    function retireLaunchTemplate(bytes32 arg0, bytes32 arg1) external;
    function launchTemplate(bytes32 arg0) external view returns (LaunchTemplate memory output0);
    function launchTemplateHash(bytes32 arg0) external view returns (bytes32 output0);
}

interface ILaunchConfigResolver {
    function resolve(bytes32 arg0, bytes32 arg1, bytes32 arg2) external view returns (QuoteAssetConfig memory output0, TickerGardenBaseline memory output1, LaunchTemplate memory output2);
    function approvedQuoteRegistry() external view returns (address output0);
    function tickerGardenBaselineRegistry() external view returns (address output0);
    function launchTemplateRegistry() external view returns (address output0);
}

interface ITickerGardenFactoryV1 {
    event MarketCreated(bytes32 indexed marketId, bytes32 indexed assetUid, address indexed memeToken, address curve, address gauge, address quoteAsset, bytes32 tickerGardenBaselineId, bytes32 quoteAssetConfigId, bytes32 expectedEconomics);

    function createMarket(CreateMarketParams calldata arg0) external payable returns (bytes32 output0, address output1, address output2, address output3);
    function createMarketFor(address arg0, CreateMarketParams calldata arg1) external payable returns (bytes32 output0, address output1, address output2, address output3);
    function previewMarketEconomics(CreateMarketParams calldata arg0) external view returns (bytes32 output0);
    function predictMarketAddresses(address arg0, CreateMarketParams calldata arg1) external view returns (bytes32 output0, address output1, address output2, address output3, address output4);
    function launchFee() external view returns (uint256 output0);
    function holderRewardsDistributor() external view returns (address output0);
    function creatorRevenueRegistry() external view returns (address output0);
    function runtimeBindings() external view returns (address output0, address output1, address output2, address output3, address output4, address output5, address output6, address output7);
}

interface IMarketRegistryV1 {
    event MarketRegistered(bytes32 indexed marketId, bytes32 indexed assetUid, address indexed memeToken, address curve, address gauge, uint32 sourceVersion);
    event LaunchPhaseChanged(bytes32 indexed marketId, uint8 oldPhase, uint8 newPhase, bytes32 poolId, uint32 sourceVersion);

    function registerMarket(bytes32 arg0, MarketConfig calldata arg1) external;
    function commitPoolCreated(bytes32 arg0, bytes32 arg1) external returns (uint32 output0);
    function market(bytes32 arg0) external view returns (MarketView memory output0);
    function marketIdByToken(address arg0) external view returns (bytes32 output0);
    function canonicalPoolKey(bytes32 arg0) external view returns (PoolKey memory output0);
    function canonicalPoolId(bytes32 arg0) external view returns (bytes32 output0);
    function canonicalRoute(bytes32 arg0) external view returns (CanonicalRoute memory output0);
    function activeFeeSource(bytes32 arg0) external view returns (address output0, uint32 output1);
    function factory() external view returns (address output0);
    function officialStockRegistry() external view returns (address output0);
    function approvedQuoteRegistry() external view returns (address output0);
    function tickerGardenBaselineRegistry() external view returns (address output0);
    function launchTemplateRegistry() external view returns (address output0);
    function graduationExecutor() external view returns (address output0);
    function swapRouter() external view returns (address output0);
    function quoter() external view returns (address output0);
}

interface ILaunchAndBuyRouter {
    function launchAndBuy(CreateMarketParams calldata arg0, uint256 arg1, uint256 arg2, address arg3) external payable returns (bytes32 output0, address output1, uint256 output2, uint256 output3);
    function unlockCallback(bytes calldata arg0) external returns (bytes memory output0);
    function factory() external view returns (address output0);
    function approvedQuoteRegistry() external view returns (address output0);
    function poolManager() external view returns (address output0);
}

interface ITickerMemeTokenV1 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function name() external view returns (string memory output0);
    function symbol() external view returns (string memory output0);
    function decimals() external view returns (uint8 output0);
    function totalSupply() external view returns (uint256 output0);
    function balanceOf(address arg0) external view returns (uint256 output0);
    function transfer(address arg0, uint256 arg1) external returns (bool output0);
    function allowance(address arg0, address arg1) external view returns (uint256 output0);
    function approve(address arg0, uint256 arg1) external returns (bool output0);
    function transferFrom(address arg0, address arg1, uint256 arg2) external returns (bool output0);
    function marketId() external view returns (bytes32 output0);
    function creator() external view returns (address output0);
    function factory() external view returns (address output0);
    function holderRewardsDistributor() external view returns (address output0);
    function metadataURI() external view returns (string memory output0);
    function initialSupply() external view returns (uint256 output0);
    function deployedAt() external view returns (uint64 output0);
    function continuousRewardsEnabled() external view returns (bool output0);
    function enableContinuousRewards() external;
}

interface ITickerGardenCurve {
    event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax);
    event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax);
    event CurveBuyRefunded(address indexed buyer, uint256 unusedQuote);
    event CurveCompleted(bytes32 indexed marketId);
    event CurveFeeTransferred(bytes32 indexed marketId, uint64 indexed sweepNonce, bytes32 indexed feeId, uint256 amount);

    function buy(uint256 arg0, uint256 arg1, address arg2) external payable returns (uint256 output0, uint256 output1);
    function sell(uint256 arg0, uint256 arg1, address arg2) external returns (uint256 output0, uint256 output1);
    function sweepCurveFees() external returns (uint256 output0);
    function quoteBuy(uint256 arg0, address arg1) external view returns (uint256 output0, uint256 output1, uint256 output2);
    function quoteSell(uint256 arg0) external view returns (uint256 output0, uint256 output1);
    function quoteAsset() external view returns (address output0);
    function getReserves() external view returns (uint256 output0, uint256 output1);
    function realQuoteReserve() external view returns (uint256 output0);
    function sellableTokens() external view returns (uint256 output0);
    function reservedTokens() external view returns (uint256 output0);
    function readyToGraduate() external view returns (bool output0);
    function accruedCurveFees() external view returns (uint256 output0);
    function creatorTaxBps() external view returns (uint16 output0);
    function accruedCreatorTax() external view returns (uint256 output0);
    function sweepNonce() external view returns (uint64 output0);
}

interface IUserStockVault {
    event StockDeposited(bytes32 indexed assetUid, address indexed user, uint256 amount);
    event StockWithdrawn(bytes32 indexed assetUid, address indexed user, uint256 amount);
    event AllocationLocked(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount, uint256 userMarketAllocation, uint256 userTotalAllocated);
    event AllocationReleased(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount, uint256 userMarketAllocation, uint256 userTotalAllocated);
    event AllocationRageQuit(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount);
    event RageQuitRewardSettlementQueued(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 principal);
    event RageQuitRewardSettlementCompleted(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 principal);

    function depositStock(bytes32 arg0, uint256 arg1) external;
    function depositStockFor(bytes32 arg0, address arg1, uint256 arg2) external;
    function withdrawFreeStock(bytes32 arg0, uint256 arg1) external;
    function rageQuit(bytes32 arg0, bytes32 arg1) external returns (uint256 output0);
    function lockAllocation(bytes32 arg0, address arg1, bytes32 arg2, uint256 arg3) external;
    function releaseAllocation(bytes32 arg0, address arg1, bytes32 arg2) external returns (uint256 output0);
    function releaseAllocationAndWithdraw(bytes32 arg0, address arg1, bytes32 arg2) external returns (uint256 output0);
    function rageQuitAllocation(bytes32 arg0, address arg1, bytes32 arg2) external returns (uint256 output0);
    function completeRageQuitRewardSettlement(bytes32 arg0, address arg1, bytes32 arg2) external returns (uint256 output0);
    function recordGaugeRewardState(bytes32 arg0, bytes32 arg1, uint256 arg2, uint256 arg3) external;
    function deposited(bytes32 arg0, address arg1) external view returns (uint256 output0);
    function allocated(bytes32 arg0, address arg1) external view returns (uint256 output0);
    function allocation(bytes32 arg0, address arg1, bytes32 arg2) external view returns (uint256 output0);
    function rageQuitSettlementPrincipal(bytes32 arg0, address arg1, bytes32 arg2) external view returns (uint256 output0);
    function rageQuitRewardCutoff(bytes32 arg0, address arg1, bytes32 arg2) external view returns (uint256 output0, uint256 output1, uint256 output2);
    function freeBalanceOf(bytes32 arg0, address arg1) external view returns (uint256 output0);
    function marketAllocated(bytes32 arg0, bytes32 arg1) external view returns (uint256 output0);
    function marketRewardEligible(bytes32 arg0, bytes32 arg1) external view returns (uint256 output0);
    function marketRewardCohortEpoch(bytes32 arg0, bytes32 arg1) external view returns (uint256 output0);
    function totalDeposited(bytes32 arg0) external view returns (uint256 output0);
    function totalAllocated(bytes32 arg0) external view returns (uint256 output0);
    function vaultIdentity() external view returns (address output0, address output1, address output2, bytes32 output3);
}

interface IAllocationManager {
    event AllocationRageQuitExecuted(address indexed user, bytes32 indexed marketId, uint256 principal, uint256 quoteForfeited, uint256 memeForfeited);
    event RageQuitRewardSettlementDeferred(address indexed user, bytes32 indexed marketId, uint256 principal, address gauge);
    event RageQuitRewardSettlementFinalized(address indexed user, bytes32 indexed marketId, uint256 principal, uint256 quoteForfeited, uint256 memeForfeited);

    function allocate(bytes32 arg0, uint256 arg1) external;
    function stake(bytes32 arg0, uint256 arg1) external;
    function increaseAllocation(bytes32 arg0, uint256 arg1) external;
    function closeAllocation(bytes32 arg0) external;
    function unstakeAndWithdraw(bytes32 arg0) external;
    function rageQuit(bytes32 arg0) external;
    function settleRageQuitRewards(bytes32 arg0, address arg1) external returns (uint256 output0, uint256 output1);
    function rageQuitSettlementPending(bytes32 arg0, address arg1) external view returns (bool output0, uint256 output1);
    function rageQuitRewardCutoff(bytes32 arg0, address arg1) external view returns (uint256 output0, uint256 output1, uint256 output2);
    function rewardEligibleActiveStock(bytes32 arg0) external view returns (uint256 output0);
    function rewardCohortEpoch(bytes32 arg0) external view returns (uint256 output0);
    function recordGaugeRewardState(bytes32 arg0, uint256 arg1, uint256 arg2) external;
    function depositAndAllocate(bytes32 arg0, uint256 arg1, uint256 arg2) external;
    function officialStockRegistry() external view returns (address output0);
    function marketRegistry() external view returns (address output0);
}

interface IMemeStockGauge {
    event PendingScheduled(address indexed user, bytes32 indexed marketId, uint256 amount, uint64 generation, uint64 unlockAt);
    event PendingRescheduled(address indexed user, bytes32 indexed marketId, uint64 oldGeneration, uint64 newGeneration, uint256 combinedAmount, uint64 unlockAt);
    event ActivationBucketProcessed(bytes32 indexed marketId, uint64 indexed generation, uint256 amount, uint256 quoteAccumulator, uint256 memeAccumulator, uint256 refs);
    event PendingMaterialized(address indexed user, bytes32 indexed marketId, uint64 indexed generation, uint256 amount);
    event StakerFeeCredited(bytes32 indexed marketId, address indexed feeAsset, bytes32 indexed feeId, uint256 amount, uint256 accumulatorDelta, uint256 indexRemainder);
    event GaugeRageQuit(address indexed user, bytes32 indexed marketId, uint256 principal, uint256 quoteForfeited, uint256 memeForfeited);
    event ForfeitureRecordDeferred(bytes32 indexed marketId, address indexed user, uint256 quoteAmount, uint256 memeAmount, uint256 totalDeferredQuote, uint256 totalDeferredMeme);
    event ForfeitureRecordFlushed(bytes32 indexed marketId, uint256 quoteAmount, uint256 memeAmount);

    function gaugeIdentity() external view returns (GaugeIdentity memory output0);
    function addPending(address arg0, uint256 arg1, uint64 arg2, uint64 arg3) external;
    function removeAllocation(address arg0) external returns (uint256 output0);
    function rageQuit(address arg0) external returns (uint256 output0, uint256 output1, uint256 output2);
    function checkpointActivations() external returns (uint256 output0, uint256 output1);
    function flushDeferredForfeiture() external;
    function settle(address arg0) external;
    function creditStakerFee(address arg0, uint256 arg1, bytes32 arg2) external returns (uint256 output0, uint256 output1);
    function consumeClaimable(address arg0) external returns (uint256 output0, uint256 output1);
    function consumeClaimableAssets(address arg0, uint8 arg1) external returns (uint256 output0, uint256 output1);
    function positionOf(address arg0) external view returns (PositionView memory output0);
    function rewardState(address arg0) external view returns (RewardStateView memory output0);
    function storedTotalActiveStock() external view returns (uint256 output0);
    function effectiveTotalActiveStock() external view returns (uint256 output0);
    function totalPendingStock() external view returns (uint256 output0);
    function activationSlot(uint8 arg0) external view returns (ActivationSlot memory output0);
    function activationSnapshot(uint64 arg0) external view returns (ActivationSnapshot memory output0);
    function deferredForfeiture() external view returns (uint256 output0, uint256 output1);
    function restoreUserMemeRewards(address arg0, uint256 arg1) external;
}

interface ITickerGardenMemeHook {
    event ExpectedPoolRegistered(bytes32 indexed marketId, bytes32 indexed poolId, bytes32 keyHash, uint32 sourceVersion);
    event PoolBindingActivated(bytes32 indexed marketId, bytes32 indexed poolId, uint32 sourceVersion);
    event V4FeeAccrued(bytes32 indexed marketId, bytes32 indexed poolId, address indexed feeAsset, uint64 feeNonce, bytes32 feeId, uint256 base, uint256 totalFee, uint256 lpAmount, uint256 nonLpAmount);

    function convertRewards(bytes32 arg0, uint256 arg1, uint256 arg2) external returns (uint256 output0, uint256 output1);
    function unlockCallback(bytes calldata arg0) external returns (bytes memory output0);
    function registerExpectedPool(bytes32 arg0, PoolKey calldata arg1, uint32 arg2) external returns (bytes32 output0);
    function activatePool(bytes32 arg0) external;
    function beforeInitialize(address arg0, PoolKey calldata arg1, uint160 arg2) external returns (bytes4 output0);
    function afterSwap(address arg0, PoolKey calldata arg1, SwapParams calldata arg2, int256 arg3, bytes calldata arg4) external returns (bytes4 output0, int128 output1);
    function marketOfPool(bytes32 arg0) external view returns (bytes32 output0);
    function poolBinding(bytes32 arg0) external view returns (PoolBinding memory output0);
    function hookPermissionMask() external pure returns (uint160 output0);
    function marketRegistry() external view returns (address output0);
    function poolManager() external view returns (address output0);
    function protocolFeeVault() external view returns (address output0);
    function graduationExecutor() external view returns (address output0);
}

interface IProtocolFeeVault {
    event FeeBucketsCredited(bytes32 indexed marketId, uint32 indexed creatorEpoch, address indexed feeAsset, bytes32 feeId, uint256 creatorAmount, uint256 stakerAmount, uint256 platformAmount, uint256 activeStock);
    event CurveFeesSwept(bytes32 indexed marketId, uint32 indexed creatorEpoch, address indexed quoteAsset, uint64 sweepNonce, bytes32 feeId, uint256 amount, uint256 creatorAmount, uint256 platformAmount);
    event FeeClaimed(uint8 indexed beneficiaryType, address indexed beneficiary, bytes32 indexed marketId, uint32 beneficiaryEpoch, address feeAsset, uint256 amount);
    event ForfeitureReserved(bytes32 indexed marketId, address indexed user, address indexed feeAsset, uint256 amount, uint256 reserveBalance);
    event ForfeitureReserveConverted(bytes32 indexed marketId, address indexed feeAsset, uint256 amount);
    event RewardConverted(bytes32 indexed marketId, address indexed user, uint32 indexed creatorEpoch, uint256 memeSpent, uint256 quoteReceived);
    event HolderFeesAccrued(bytes32 indexed marketId, uint32 indexed epochId, address indexed feeAsset, uint256 amount);
    event UserRewardsClaimed(bytes32 indexed marketId, address indexed user, uint8 indexed role, uint32 creatorEpoch, uint256 quotePaid, uint256 memePaid, uint256 memeRetained, uint256 memeConverted, bool conversionFailed);
    event PlatformTreasuryProposed(uint256 indexed nonce, address indexed oldTreasury, address indexed newTreasury, address proposer, uint256 readyAt, bytes32 codeHash);
    event PlatformTreasuryAccepted(uint256 indexed nonce, address indexed newTreasury);
    event PlatformTreasuryCancelled(uint256 indexed nonce, address indexed caller);
    event PlatformTreasuryChanged(uint256 indexed nonce, address indexed oldTreasury, address indexed newTreasury);

    function beginV4Credit(bytes32 arg0, address arg1, uint256 arg2, uint32 arg3, bytes32 arg4) external;
    function finalizeV4Credit(bytes32 arg0, address arg1, uint256 arg2, uint256 arg3, uint256 arg4, uint256 arg5, uint64 arg6, bytes32 arg7) external;
    function beginCurveCredit(bytes32 arg0, address arg1, uint256 arg2, uint256 arg3, uint32 arg4, uint64 arg5, bytes32 arg6) external;
    function finalizeCurveCredit(bytes32 arg0, address arg1, uint256 arg2, uint256 arg3, uint32 arg4, uint64 arg5, bytes32 arg6) external payable;
    function claimPlatform(bytes32 arg0, address arg1) external returns (uint256 output0);
    function recordForfeiture(bytes32 arg0, address arg1, uint256 arg2, uint256 arg3) external;
    function liability(bytes32 arg0, address arg1, uint8 arg2) external view returns (uint256 output0);
    function creatorLiability(bytes32 arg0, uint32 arg1, address arg2) external view returns (uint256 output0);
    function forfeitureReserve(bytes32 arg0, address arg1) external view returns (uint256 output0);
    function totalLiability(address arg0) external view returns (uint256 output0);
    function consumedFeeId(bytes32 arg0) external view returns (bool output0);
    function marketRegistry() external view returns (address output0);
    function poolManager() external view returns (address output0);
    function creatorRevenueRegistry() external view returns (address output0);
    function platformTreasury() external view returns (address output0);
    function feePolicyId() external view returns (bytes32 output0);
    function feePolicyHash() external view returns (bytes32 output0);
    function holderLiability(bytes32 arg0, uint32 arg1, address arg2) external view returns (uint256 output0);
    function fundHolderRewards(bytes32 arg0, uint32 arg1) external returns (uint256 output0);
    function claimUserRewards(bytes32 arg0, uint8 arg1, uint32 arg2, bool arg3, bool arg4, uint256 arg5) external returns (uint256 output0, uint256 output1, uint256 output2);
    function claimUserRewardAssets(bytes32 arg0, uint8 arg1, uint32 arg2, uint8 arg3, bool arg4, bool arg5, uint256 arg6) external returns (uint256 output0, uint256 output1, uint256 output2);
    function userClaimMode() external pure returns (bytes32 output0);
    function convertUserClaim(bytes32 arg0, MarketView calldata arg1, uint256 arg2, uint256 arg3) external returns (uint256 output0, uint256 output1);
    function fundHolderMemeRewards(bytes32 arg0) external returns (uint256 output0);
    function proposePlatformTreasury(address arg0) external;
    function acceptPlatformTreasury(uint256 arg0) external;
    function cancelPlatformTreasury(uint256 arg0) external;
    function executePlatformTreasury(uint256 arg0) external;
    function authority() external view returns (address output0);
    function TREASURY_CHANGE_DELAY() external view returns (uint256 output0);
    function treasuryProposalNonce() external view returns (uint256 output0);
    function pendingPlatformTreasury() external view returns (address output0);
    function treasuryProposer() external view returns (address output0);
    function treasuryChangeReadyAt() external view returns (uint256 output0);
    function treasuryChangeAccepted() external view returns (bool output0);
    function pendingTreasuryCodeHash() external view returns (bytes32 output0);
}

interface IGraduationExecutor {
    event PoolGraduated(bytes32 indexed marketId, bytes32 indexed poolId, address indexed launchLocker, uint256 sweptQuote, uint256 sweptTokens, uint256 poolQuoteAmount, uint256 poolMemeAmount, uint256 lockedExcessQuote, uint256 lockedExcessMeme, uint32 sourceVersion);

    function graduateFromCurve(bytes32 arg0, uint256 arg1, uint256 arg2) external payable;
    function predictLaunchLocker(bytes32 arg0) external view returns (address output0);
    function marketRegistry() external view returns (address output0);
    function approvedQuoteRegistry() external view returns (address output0);
    function factory() external view returns (address output0);
    function poolManager() external view returns (address output0);
    function positionManager() external view returns (address output0);
    function permit2() external view returns (address output0);
    function hook() external view returns (address output0);
    function launchLockerCreationCodeHash() external view returns (bytes32 output0);
}

interface ILaunchLocker {
    function marketId() external view returns (bytes32 output0);
    function lockedPosition() external view returns (uint256 output0, bytes32 output1);
    function unpairedLockedBalance(address arg0) external view returns (uint256 output0);
}

interface ICreatorRevenueRegistry {
    event CreatorRevenueEpochInitialized(bytes32 indexed marketId, uint32 indexed epoch, address indexed beneficiary);
    event CreatorRevenueBeneficiaryUpdated(bytes32 indexed marketId, uint32 indexed oldEpoch, uint32 indexed newEpoch, address oldBeneficiary, address newBeneficiary);
    event CreatorRevenueBeneficiaryProposed(bytes32 indexed marketId, uint32 indexed epoch, address indexed currentBeneficiary, address pendingBeneficiary);
    event CreatorRevenueBeneficiaryTransferCancelled(bytes32 indexed marketId, uint32 indexed epoch);

    function initializeCreatorRevenueEpoch(bytes32 arg0, address arg1) external;
    function transferCreatorRevenueBeneficiary(bytes32 arg0, address arg1) external returns (uint32 output0);
    function currentCreatorEpoch(bytes32 arg0) external view returns (uint32 output0);
    function creatorBeneficiaryAt(bytes32 arg0, uint32 arg1) external view returns (address output0);
    function factory() external view returns (address output0);
    function marketRegistry() external view returns (address output0);
    function pendingCreatorRevenueBeneficiary(bytes32 arg0) external view returns (address output0);
    function acceptCreatorRevenueBeneficiary(bytes32 arg0) external returns (uint32 output0);
    function cancelCreatorRevenueBeneficiaryTransfer(bytes32 arg0) external;
}

// forgefmt: disable-end
// forge-lint: disable-end(multi-contract-file)
