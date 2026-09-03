// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// GENERATED FILE. DO NOT EDIT.
// Source: spec/v2_abi_surface.json (V2-EXEC-4)
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

struct QuoteAssetConfig {
    bytes32 ponsBaselineId;
    address quoteAsset;
    uint8 quoteDecimals;
    uint256 phantomQuote;
    uint256 graduationThreshold;
    bytes32 economicsHash;
    uint8 status;
}

struct PonsBaseline {
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
    address launchLockerImplementation;
    bytes32 launchLockerCodeHash;
    bytes32 feePolicyId;
    bytes32 executionSpecId;
    uint8 status;
}

struct CreateMarketParams {
    bytes32 assetUid;
    bytes32 ponsBaselineId;
    bytes32 quoteAssetConfigId;
    bytes32 launchTemplateId;
    bytes32 expectedEconomics;
    address creatorRevenueBeneficiary;
    string name;
    string symbol;
    string metadataURI;
    bytes32 salt;
}

struct MarketConfig {
    bytes32 assetUid;
    bytes32 ponsBaselineId;
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
    address marketController;
}

struct MarketRuntime {
    bytes32 poolId;
    uint32 sourceVersion;
    uint32 recoveryEpoch;
    uint64 sweptAt;
    uint64 statusSince;
    uint64 restrictedSince;
    uint8 launchPhase;
    uint8 marketStatus;
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
    uint8 marketStatus;
    bool curveTradingEnabled;
    bool poolTradingEnabled;
}

struct GaugeIdentity {
    bytes32 marketId;
    bytes32 assetUid;
    bytes32 quoteAssetConfigId;
    address allocationManager;
    address protocolFeeVault;
    address marketController;
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

struct RecoveryRootView {
    bytes32 root;
    uint256 declaredTotal;
    uint256 claimedTotal;
    uint64 proposedAt;
    uint64 finalizableAt;
    uint32 proposalNonce;
    uint8 status;
}

enum BucketType {
    CREATOR_REVENUE,
    STAKER_REWARD,
    PLATFORM_REVENUE
}

enum RecoveryRootStatus {
    NONE,
    PENDING,
    ACTIVE,
    CANCELLED
}

interface IV2Errors {
    error InvalidLaunchFee(uint256 arg0, uint256 arg1);
    error TemplateCodeHashMismatch(address arg0, bytes32 arg1, bytes32 arg2);
    error UnauthorizedMarketCurve(address arg0, address arg1);
    error CurveFeeSweepAfterClose(bytes32 arg0);
    error GraduationNotRetryable(bytes32 arg0, uint8 arg1, uint8 arg2);
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
    error ActivationSlotCollision(uint8 arg0, uint64 arg1, uint64 arg2);
    error PendingGenerationNotFound(uint64 arg0);
    error InvalidMinimumAllocation(bytes32 arg0, uint256 arg1);
    error AssetNotRegistered(bytes32 arg0);
    error InvalidAssetMinimumAllocation(bytes32 arg0, uint256 arg1);
    error PositionBelowMinimum(uint256 arg0, uint256 arg1);
    error PositionLockedUntil(uint64 arg0);
    error InvalidRageQuitAmount(uint256 arg0, uint256 arg1);
    error InvalidRageQuitUser(address arg0);
    error NoRageQuitPosition(address arg0);
    error UnauthorizedForfeitureGauge(address arg0, address arg1);
    error InvalidForfeiture(address arg0, uint256 arg1, uint256 arg2);
    error AllocationExceedsDeposit(uint256 arg0, uint256 arg1);
    error AllocationLedgerMismatch();
    error StockAllocationClosed(bytes32 arg0);
    error InvalidStateTransition(uint8 arg0, uint8 arg1);
    error PreGraduationTerminalStateForbidden(uint8 arg0);
    error EmergencyExitNotReady(uint64 arg0);
    error RecoveryCapsAlreadyFrozen(bytes32 arg0, uint32 arg1);
    error RecoveryCapSnapshotMismatch(bytes32 arg0, uint32 arg1);
    error EmergencyStateHashMismatch(bytes32 arg0, bytes32 arg1);
    error GaugePermanentlyDisabled(bytes32 arg0);
    error RecoveryCapExceeded(address arg0, uint256 arg1, uint256 arg2);
    error RecoveryAlreadyClaimed(address arg0, address arg1);
    error InvalidRecoveryProof();
    error ArbitraryRecipientForbidden();
}

interface IOfficialStockRegistryV2 {
    event StockVaultRegistered(address indexed userStockVault, bytes32 indexed schemaId, address indexed marketRegistry, address allocationManager);
    event AssetRegistered(bytes32 indexed assetUid, address indexed stockToken, address indexed userStockVault, uint8 tokenDecimals);
    event AssetMinimumAllocationChanged(bytes32 indexed assetUid, uint256 oldMinimum, uint256 newMinimum, bytes32 reasonHash);
    event AssetStatusChanged(bytes32 indexed assetUid, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function registerAsset(bytes32 arg0, address arg1, uint8 arg2, address arg3, uint256 arg4) external;
    function setMinimumAllocation(bytes32 arg0, uint256 arg1, bytes32 arg2) external;
    function pauseAsset(bytes32 arg0, bytes32 arg1) external;
    function unpauseAsset(bytes32 arg0) external;
    function retireAsset(bytes32 arg0, bytes32 arg1) external;
    function asset(bytes32 arg0) external view returns (AssetView memory output0);
    function minimumAllocation(bytes32 arg0) external view returns (uint256 output0);
    function vaultSchemaId(address arg0) external view returns (bytes32 output0);
    function vaultForSchema(bytes32 arg0) external view returns (address output0);
}

interface IApprovedQuoteRegistry {
    event QuoteAssetConfigAdded(bytes32 indexed configId, address indexed quoteAsset, bytes32 indexed ponsBaselineId, bytes32 economicsHash);
    event QuoteAssetStatusChanged(bytes32 indexed configId, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function addQuoteConfig(bytes32 arg0, QuoteAssetConfig calldata arg1) external;
    function pauseQuote(bytes32 arg0, bytes32 arg1) external;
    function unpauseQuote(bytes32 arg0) external;
    function retireQuote(bytes32 arg0, bytes32 arg1) external;
    function quoteConfig(bytes32 arg0) external view returns (QuoteAssetConfig memory output0);
}

interface IPonsBaselineRegistry {
    event PonsBaselineAdded(bytes32 indexed baselineId, bytes32 indexed behaviorVectorRoot, bytes32 factoryCodeHash);
    event PonsBaselineStatusChanged(bytes32 indexed baselineId, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function addBaseline(bytes32 arg0, PonsBaseline calldata arg1) external;
    function pauseBaseline(bytes32 arg0, bytes32 arg1) external;
    function unpauseBaseline(bytes32 arg0) external;
    function retireBaseline(bytes32 arg0, bytes32 arg1) external;
    function baseline(bytes32 arg0) external view returns (PonsBaseline memory output0);
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
    function resolve(bytes32 arg0, bytes32 arg1, bytes32 arg2) external view returns (QuoteAssetConfig memory output0, PonsBaseline memory output1, LaunchTemplate memory output2);
    function approvedQuoteRegistry() external view returns (address output0);
    function ponsBaselineRegistry() external view returns (address output0);
    function launchTemplateRegistry() external view returns (address output0);
}

interface ITickerGardenFactoryV2 {
    event MarketCreated(bytes32 indexed marketId, bytes32 indexed assetUid, address indexed memeToken, address curve, address gauge, address quoteAsset, bytes32 ponsBaselineId, bytes32 quoteAssetConfigId, bytes32 expectedEconomics);

    function createMarket(CreateMarketParams calldata arg0) external payable returns (bytes32 output0, address output1, address output2, address output3);
    function createMarketFor(address arg0, CreateMarketParams calldata arg1) external payable returns (bytes32 output0, address output1, address output2, address output3);
    function previewMarketEconomics(CreateMarketParams calldata arg0) external view returns (bytes32 output0);
    function predictMarketAddresses(address arg0, CreateMarketParams calldata arg1) external view returns (bytes32 output0, address output1, address output2, address output3, address output4);
    function launchFee() external view returns (uint256 output0);
    function runtimeBindings() external view returns (address output0, address output1, address output2, address output3, address output4, address output5, address output6, address output7);
}

interface IMarketRegistryV2 {
    event MarketRegistered(bytes32 indexed marketId, bytes32 indexed assetUid, address indexed memeToken, address curve, address gauge, uint32 sourceVersion);
    event LaunchPhaseChanged(bytes32 indexed marketId, uint8 oldPhase, uint8 newPhase, uint64 sweptAt, bytes32 poolId, uint32 sourceVersion);
    event MarketStatusChanged(bytes32 indexed marketId, uint8 oldStatus, uint8 newStatus, uint64 statusSince, uint64 restrictedSince, bytes32 reasonHash);
    event EmergencyStateCommitted(bytes32 indexed marketId, uint32 indexed recoveryEpoch, uint32 sourceVersion, uint64 snapshotBlock, bytes32 stateHash);

    function registerMarket(bytes32 arg0, MarketConfig calldata arg1) external;
    function markSwept(bytes32 arg0) external;
    function commitPoolCreated(bytes32 arg0, bytes32 arg1) external returns (uint32 output0);
    function markRescued(bytes32 arg0) external;
    function setMarketPaused(bytes32 arg0, bytes32 arg1) external;
    function setMarketActive(bytes32 arg0) external;
    function setMarketRetired(bytes32 arg0, bytes32 arg1) external;
    function commitEmergencyExit(bytes32 arg0, uint64 arg1, bytes32 arg2) external returns (uint32 output0);
    function market(bytes32 arg0) external view returns (MarketView memory output0);
    function marketIdByToken(address arg0) external view returns (bytes32 output0);
    function canonicalPoolKey(bytes32 arg0) external view returns (PoolKey memory output0);
    function canonicalPoolId(bytes32 arg0) external view returns (bytes32 output0);
    function canonicalRoute(bytes32 arg0) external view returns (CanonicalRoute memory output0);
    function activeFeeSource(bytes32 arg0) external view returns (address output0, uint32 output1);
}

interface ILaunchAndBuyRouter {
    function launchAndBuy(CreateMarketParams calldata arg0, uint256 arg1, uint256 arg2, address arg3) external payable returns (bytes32 output0, address output1, uint256 output2, uint256 output3);
}

interface ITickerMemeTokenV2 {
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
    function metadataURI() external view returns (string memory output0);
    function initialSupply() external view returns (uint256 output0);
}

interface IPonsCompatibleCurve {
    event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax);
    event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax);
    event CurveBuyRefunded(address indexed buyer, uint256 unusedQuote);
    event CurveCompleted(bytes32 indexed marketId);
    event CurveFeeTransferred(bytes32 indexed marketId, uint64 indexed sweepNonce, bytes32 indexed feeId, uint256 amount);
    event LaunchSwept(bytes32 indexed marketId, address indexed quoteAsset, uint256 sweptQuote, uint256 sweptTokens, uint64 sweptAt);
    event AutoGraduationFailed(bytes32 indexed marketId, bytes32 reasonHash);

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
    function sweepNonce() external view returns (uint64 output0);
}

interface IUserStockVault {
    event StockDeposited(bytes32 indexed assetUid, address indexed user, uint256 amount);
    event StockWithdrawn(bytes32 indexed assetUid, address indexed user, uint256 amount);
    event AllocationLocked(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount, uint256 userMarketAllocation, uint256 userTotalAllocated);
    event AllocationReleased(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount, uint256 userMarketAllocation, uint256 userTotalAllocated);
    event AllocationRageQuit(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount);
    event AllocationMoved(bytes32 indexed assetUid, address indexed user, bytes32 indexed fromMarketId, bytes32 toMarketId, uint256 amount);
    event AllocationForceReleased(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount, uint32 recoveryEpoch);

    function depositStock(bytes32 arg0, uint256 arg1) external;
    function depositStockFor(bytes32 arg0, address arg1, uint256 arg2) external;
    function withdrawFreeStock(bytes32 arg0, uint256 arg1) external;
    function forceReleaseAllocation(bytes32 arg0, bytes32 arg1) external returns (uint256 output0);
    function lockAllocation(bytes32 arg0, address arg1, bytes32 arg2, uint256 arg3) external;
    function releaseAllocation(bytes32 arg0, address arg1, bytes32 arg2, uint256 arg3) external;
    function rageQuitAllocation(bytes32 arg0, address arg1, bytes32 arg2, uint256 arg3) external;
    function moveAllocation(bytes32 arg0, address arg1, bytes32 arg2, bytes32 arg3, uint256 arg4) external;
    function deposited(bytes32 arg0, address arg1) external view returns (uint256 output0);
    function allocated(bytes32 arg0, address arg1) external view returns (uint256 output0);
    function allocation(bytes32 arg0, address arg1, bytes32 arg2) external view returns (uint256 output0);
    function freeBalanceOf(bytes32 arg0, address arg1) external view returns (uint256 output0);
    function marketAllocated(bytes32 arg0, bytes32 arg1) external view returns (uint256 output0);
    function totalDeposited(bytes32 arg0) external view returns (uint256 output0);
    function totalAllocated(bytes32 arg0) external view returns (uint256 output0);
    function vaultIdentity() external view returns (address output0, address output1, address output2, bytes32 output3);
}

interface IAllocationManager {
    event AllocationMigrated(address indexed user, bytes32 indexed fromMarketId, bytes32 indexed toMarketId, uint256 amount, uint256 sourceRemaining, uint64 targetPendingGeneration, uint64 targetUnlockAt);
    event AllocationRageQuitExecuted(address indexed user, bytes32 indexed marketId, uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed);

    function allocate(bytes32 arg0, uint256 arg1) external;
    function increaseAllocation(bytes32 arg0, uint256 arg1) external;
    function decreaseAllocation(bytes32 arg0, uint256 arg1) external;
    function closeAllocation(bytes32 arg0) external;
    function rageQuit(bytes32 arg0) external;
    function migrateAllocation(bytes32 arg0, bytes32 arg1, uint256 arg2) external;
    function depositAndAllocate(bytes32 arg0, uint256 arg1, uint256 arg2) external;
}

interface IMemeStockGauge {
    event PendingScheduled(address indexed user, bytes32 indexed marketId, uint256 amount, uint64 generation, uint64 unlockAt);
    event PendingRescheduled(address indexed user, bytes32 indexed marketId, uint64 oldGeneration, uint64 newGeneration, uint256 combinedAmount, uint64 unlockAt);
    event ActivationBucketProcessed(bytes32 indexed marketId, uint64 indexed generation, uint256 amount, uint256 quoteAccumulator, uint256 memeAccumulator, uint256 refs);
    event PendingMaterialized(address indexed user, bytes32 indexed marketId, uint64 indexed generation, uint256 amount);
    event StakerFeeCredited(bytes32 indexed marketId, address indexed feeAsset, bytes32 indexed feeId, uint256 amount, uint256 accumulatorDelta, uint256 indexRemainder);
    event ForfeitedRewardRedistributed(bytes32 indexed marketId, address indexed user, address indexed feeAsset, uint256 amount, uint256 accumulatorDelta, uint256 indexRemainder);
    event GaugeRageQuit(address indexed user, bytes32 indexed marketId, uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed);

    function gaugeIdentity() external view returns (GaugeIdentity memory output0);
    function addPending(address arg0, uint256 arg1, uint64 arg2, uint64 arg3) external;
    function removeAllocation(address arg0, uint256 arg1) external;
    function rageQuit(address arg0) external returns (uint256 output0, uint256 output1, uint256 output2, bool output3);
    function checkpointActivations() external returns (uint256 output0, uint256 output1);
    function settle(address arg0) external;
    function creditStakerFee(address arg0, uint256 arg1, bytes32 arg2) external returns (uint256 output0, uint256 output1);
    function consumeClaimable(address arg0, address arg1) external returns (uint256 output0);
    function disableForEmergency(uint32 arg0, uint64 arg1, bytes32 arg2) external;
    function positionOf(address arg0) external view returns (PositionView memory output0);
    function rewardState(address arg0) external view returns (RewardStateView memory output0);
    function storedTotalActiveStock() external view returns (uint256 output0);
    function effectiveTotalActiveStock() external view returns (uint256 output0);
    function totalPendingStock() external view returns (uint256 output0);
    function activationSlot(uint8 arg0) external view returns (ActivationSlot memory output0);
    function activationSnapshot(uint64 arg0) external view returns (ActivationSnapshot memory output0);
}

interface ITickerGardenMemeHook {
    event ExpectedPoolRegistered(bytes32 indexed marketId, bytes32 indexed poolId, bytes32 keyHash, uint32 sourceVersion);
    event PoolBindingActivated(bytes32 indexed marketId, bytes32 indexed poolId, uint32 sourceVersion);
    event PoolBindingDisabled(bytes32 indexed marketId, bytes32 indexed poolId, uint32 sourceVersion);
    event V4FeeAccrued(bytes32 indexed marketId, bytes32 indexed poolId, address indexed feeAsset, uint64 feeNonce, bytes32 feeId, uint256 base, uint256 totalFee, uint256 lpAmount, uint256 nonLpAmount);

    function registerExpectedPool(bytes32 arg0, PoolKey calldata arg1, uint32 arg2) external returns (bytes32 output0);
    function activatePool(bytes32 arg0) external;
    function disablePool(bytes32 arg0) external;
    function beforeInitialize(address arg0, PoolKey calldata arg1, uint160 arg2) external returns (bytes4 output0);
    function afterSwap(address arg0, PoolKey calldata arg1, SwapParams calldata arg2, int256 arg3, bytes calldata arg4) external returns (bytes4 output0, int128 output1);
    function marketOfPool(bytes32 arg0) external view returns (bytes32 output0);
    function poolBinding(bytes32 arg0) external view returns (PoolBinding memory output0);
    function hookPermissionMask() external pure returns (uint160 output0);
}

interface IProtocolFeeVault {
    event FeeBucketsCredited(bytes32 indexed marketId, uint32 indexed creatorEpoch, address indexed feeAsset, bytes32 feeId, uint256 creatorAmount, uint256 stakerAmount, uint256 platformAmount, uint256 activeStock);
    event CurveFeesSwept(bytes32 indexed marketId, uint32 indexed creatorEpoch, address indexed quoteAsset, uint64 sweepNonce, bytes32 feeId, uint256 amount, uint256 creatorAmount, uint256 platformAmount);
    event FeeClaimed(uint8 indexed beneficiaryType, address indexed beneficiary, bytes32 indexed marketId, uint32 beneficiaryEpoch, address feeAsset, uint256 amount);
    event ForfeitureReserved(bytes32 indexed marketId, address indexed user, address indexed feeAsset, uint256 amount, uint256 reserveBalance);
    event ForfeitureReserveConverted(bytes32 indexed marketId, address indexed feeAsset, uint256 amount);
    event RecoveryCapsFrozen(bytes32 indexed marketId, uint32 indexed recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash, address quoteAsset, uint256 quoteCap, address memeAsset, uint256 memeCap);
    event RecoveryRootProposed(bytes32 indexed marketId, uint32 indexed recoveryEpoch, address indexed feeAsset, uint32 proposalNonce, bytes32 root, uint256 declaredTotal, uint64 finalizableAt);
    event RecoveryRootCancelled(bytes32 indexed marketId, uint32 indexed recoveryEpoch, address indexed feeAsset, uint32 proposalNonce);
    event RecoveryRootFinalized(bytes32 indexed marketId, uint32 indexed recoveryEpoch, address indexed feeAsset, uint32 proposalNonce, bytes32 root, uint256 declaredTotal);
    event RecoveryClaimed(bytes32 indexed marketId, uint32 indexed recoveryEpoch, address indexed feeAsset, address user, uint256 amount);

    function beginV4Credit(bytes32 arg0, address arg1, uint256 arg2, uint32 arg3, bytes32 arg4) external;
    function finalizeV4Credit(bytes32 arg0, address arg1, uint256 arg2, uint256 arg3, uint256 arg4, uint256 arg5, uint64 arg6, bytes32 arg7) external;
    function creditCurveSweep(bytes32 arg0, address arg1, uint256 arg2, uint32 arg3, uint64 arg4, bytes32 arg5) external payable;
    function claimCreator(bytes32 arg0, uint32 arg1, address arg2) external returns (uint256 output0);
    function claimPlatform(bytes32 arg0, address arg1) external returns (uint256 output0);
    function claimStaker(bytes32 arg0, address arg1) external returns (uint256 output0);
    function claimStakerFor(address arg0, bytes32 arg1, address arg2) external returns (uint256 output0);
    function recordForfeiture(bytes32 arg0, address arg1, uint256 arg2, uint256 arg3) external;
    function freezeRecoveryCaps(bytes32 arg0, uint32 arg1, uint64 arg2, bytes32 arg3) external returns (uint256 output0, uint256 output1);
    function proposeRecoveryRoot(bytes32 arg0, uint32 arg1, address arg2, bytes32 arg3, uint256 arg4) external returns (uint32 output0, uint64 output1);
    function cancelRecoveryRoot(bytes32 arg0, uint32 arg1, address arg2, uint32 arg3) external;
    function finalizeRecoveryRoot(bytes32 arg0, uint32 arg1, address arg2, uint32 arg3) external;
    function claimRecovery(bytes32 arg0, uint32 arg1, address arg2, uint256 arg3, bytes32[] calldata arg4) external;
    function liability(bytes32 arg0, address arg1, uint8 arg2) external view returns (uint256 output0);
    function creatorLiability(bytes32 arg0, uint32 arg1, address arg2) external view returns (uint256 output0);
    function forfeitureReserve(bytes32 arg0, address arg1) external view returns (uint256 output0);
    function recoverySnapshot(bytes32 arg0, uint32 arg1) external view returns (uint64 output0, bytes32 output1);
    function recoveryRoot(bytes32 arg0, uint32 arg1, address arg2) external view returns (RecoveryRootView memory output0);
    function recoveryCap(bytes32 arg0, uint32 arg1, address arg2) external view returns (uint256 output0);
    function totalLiability(address arg0) external view returns (uint256 output0);
    function consumedFeeId(bytes32 arg0) external view returns (bool output0);
}

interface IMarketController {
    event MarketStatusChanged(bytes32 indexed marketId, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);
    event EmergencyExitActivated(bytes32 indexed marketId, uint32 indexed recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash, uint256 quoteCap, uint256 memeCap);

    function pauseMarket(bytes32 arg0, bytes32 arg1) external;
    function unpauseMarket(bytes32 arg0) external;
    function retireMarket(bytes32 arg0, bytes32 arg1) external;
    function activateEmergencyExit(bytes32 arg0) external returns (uint32 output0, uint64 output1, bytes32 output2);
    function marketStatus(bytes32 arg0) external view returns (uint8 output0);
    function launchPhase(bytes32 arg0) external view returns (uint8 output0);
    function isStockAllocationOpen(bytes32 arg0) external view returns (bool output0);
}

interface IGraduationExecutor {
    event PoolGraduated(bytes32 indexed marketId, bytes32 indexed poolId, address indexed launchLocker, uint256 sweptQuote, uint256 sweptTokens, uint256 poolMemeAmount, uint256 lockedExcessMeme, uint32 sourceVersion);
    event LaunchRescued(bytes32 indexed marketId, uint64 sweptAt, uint64 rescuedAt);

    function graduateFromCurve(bytes32 arg0) external;
    function retryGraduation(bytes32 arg0) external;
    function rescueSweptLaunch(bytes32 arg0) external;
    function predictLaunchLocker(bytes32 arg0) external view returns (address output0);
}

interface ILaunchLocker {
    event LockedFeesCompounded(bytes32 indexed marketId, uint256 amount0, uint256 amount1, uint128 liquidityAdded, uint256 remaining0, uint256 remaining1);

    function compoundLockedFees() external returns (uint256 output0, uint256 output1, uint128 output2);
    function marketId() external view returns (bytes32 output0);
    function lockedPosition() external view returns (uint256 output0, bytes32 output1);
    function unpairedLockedBalance(address arg0) external view returns (uint256 output0);
}

interface ICreatorRevenueRegistry {
    event CreatorRevenueEpochInitialized(bytes32 indexed marketId, uint32 indexed epoch, address indexed beneficiary);
    event CreatorRevenueBeneficiaryUpdated(bytes32 indexed marketId, uint32 indexed oldEpoch, uint32 indexed newEpoch, address oldBeneficiary, address newBeneficiary);

    function initializeCreatorRevenueEpoch(bytes32 arg0, address arg1) external;
    function transferCreatorRevenueBeneficiary(bytes32 arg0, address arg1) external returns (uint32 output0);
    function currentCreatorEpoch(bytes32 arg0) external view returns (uint32 output0);
    function creatorBeneficiaryAt(bytes32 arg0, uint32 arg1) external view returns (address output0);
}

// forgefmt: disable-end
// forge-lint: disable-end(multi-contract-file)
