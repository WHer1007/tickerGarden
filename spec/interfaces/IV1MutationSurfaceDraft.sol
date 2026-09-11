// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// GENERATED DRAFT: do not implement against this file before V1-M0 closes.
// Source: v1_abi_surface.json + v1_permissions_matrix.json

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

struct MarketView {
    MarketConfig config;
    MarketRuntime runtime;
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
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

struct StockTokenFingerprint {
    bytes32 tokenRuntimeCodeHash;
    address beacon;
    bytes32 beaconRuntimeCodeHash;
    address implementation;
    bytes32 implementationRuntimeCodeHash;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
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

interface IOfficialStockRegistryV1MutationDraft {
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function registerAsset(bytes32, address, uint8, address, uint256, StockTokenFingerprint calldata) external;
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function acceptAssetImplementation(bytes32, address, bytes32, bytes32) external;
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function setMinimumAllocation(bytes32, uint256, bytes32) external;
    // caller=PAUSE_GUARDIAN_ROLE; executionDelay=0; stateDelay=0
    function pauseAsset(bytes32, bytes32) external;
    // caller=UNPAUSE_ROLE; executionDelay=86400; stateDelay=0
    function unpauseAsset(bytes32) external;
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function retireAsset(bytes32, bytes32) external;
}

interface IApprovedQuoteRegistryMutationDraft {
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function addQuoteConfig(bytes32, QuoteAssetConfig calldata) external;
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function addStockQuoteConfig(bytes32, QuoteAssetConfig calldata, StockQuoteBinding calldata) external;
    // caller=PAUSE_GUARDIAN_ROLE; executionDelay=0; stateDelay=0
    function pauseQuote(bytes32, bytes32) external;
    // caller=UNPAUSE_ROLE; executionDelay=86400; stateDelay=0
    function unpauseQuote(bytes32) external;
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function retireQuote(bytes32, bytes32) external;
}

interface ITickerGardenBaselineRegistryMutationDraft {
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function addBaseline(bytes32, TickerGardenBaseline calldata) external;
    // caller=PAUSE_GUARDIAN_ROLE; executionDelay=0; stateDelay=0
    function pauseBaseline(bytes32, bytes32) external;
    // caller=UNPAUSE_ROLE; executionDelay=86400; stateDelay=0
    function unpauseBaseline(bytes32) external;
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function retireBaseline(bytes32, bytes32) external;
}

interface ILaunchTemplateRegistryMutationDraft {
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function addLaunchTemplate(bytes32, LaunchTemplate calldata) external;
    // caller=PAUSE_GUARDIAN_ROLE; executionDelay=0; stateDelay=0
    function pauseLaunchTemplate(bytes32, bytes32) external;
    // caller=UNPAUSE_ROLE; executionDelay=86400; stateDelay=0
    function unpauseLaunchTemplate(bytes32) external;
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function retireLaunchTemplate(bytes32, bytes32) external;
}

interface ITickerGardenFactoryV1MutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function createMarket(CreateMarketParams calldata) external payable returns (bytes32, address, address, address);
    // caller=LAUNCH_ROUTER_MODULE; executionDelay=0; stateDelay=0
    function createMarketFor(address, CreateMarketParams calldata) external payable returns (bytes32, address, address, address);
}

interface IMarketRegistryV1MutationDraft {
    // caller=FACTORY_MODULE; executionDelay=0; stateDelay=0
    function registerMarket(bytes32, MarketConfig calldata) external;
    // caller=GRADUATION_MODULE; executionDelay=0; stateDelay=0
    function commitPoolCreated(bytes32, bytes32) external returns (uint32);
}

interface ILaunchAndBuyRouterMutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function launchAndBuy(CreateMarketParams calldata, uint256, uint256, address) external payable returns (bytes32, address, uint256, uint256);
    // caller=POOL_MANAGER; executionDelay=0; stateDelay=0
    function unlockCallback(bytes calldata) external returns (bytes);
}

interface ITickerMemeTokenV1MutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function transfer(address, uint256) external returns (bool);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function approve(address, uint256) external returns (bool);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function transferFrom(address, address, uint256) external returns (bool);
    // caller=HOLDER_REWARDS_DISTRIBUTOR_MODULE; executionDelay=0; stateDelay=0
    function enableContinuousRewards() external;
}

interface ITickerGardenCurveMutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function buy(uint256, uint256, address) external payable returns (uint256, uint256);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function sell(uint256, uint256, address) external returns (uint256, uint256);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function sweepCurveFees() external returns (uint256);
}

interface IUserStockVaultMutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function depositStock(bytes32, uint256) external;
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function depositStockFor(bytes32, address, uint256) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function withdrawFreeStock(bytes32, uint256) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function rageQuit(bytes32, bytes32) external returns (uint256);
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function lockAllocation(bytes32, address, bytes32, uint256) external;
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function releaseAllocation(bytes32, address, bytes32) external returns (uint256);
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function releaseAllocationAndWithdraw(bytes32, address, bytes32) external returns (uint256);
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function rageQuitAllocation(bytes32, address, bytes32) external returns (uint256);
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function completeRageQuitRewardSettlement(bytes32, address, bytes32) external returns (uint256);
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function recordGaugeRewardState(bytes32, bytes32, uint256, uint256) external;
}

interface IAllocationManagerMutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function allocate(bytes32, uint256) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function stake(bytes32, uint256) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function increaseAllocation(bytes32, uint256) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function closeAllocation(bytes32) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function unstakeAndWithdraw(bytes32) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function rageQuit(bytes32) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function settleRageQuitRewards(bytes32, address) external returns (uint256, uint256);
    // caller=EXACT_REGISTERED_GAUGE; executionDelay=0; stateDelay=0
    function recordGaugeRewardState(bytes32, uint256, uint256) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function depositAndAllocate(bytes32, uint256, uint256) external;
}

interface IMemeStockGaugeMutationDraft {
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function addPending(address, uint256, uint64, uint64) external;
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function removeAllocation(address) external returns (uint256);
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function rageQuit(address) external returns (uint256, uint256, uint256);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function checkpointActivations() external returns (uint256, uint256);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function flushDeferredForfeiture() external;
    // caller=ALLOCATION_MODULE_OR_FEE_VAULT; executionDelay=0; stateDelay=0
    function settle(address) external;
    // caller=FEE_VAULT; executionDelay=0; stateDelay=0
    function creditStakerFee(address, uint256, bytes32) external returns (uint256, uint256);
    // caller=FEE_VAULT; executionDelay=0; stateDelay=0
    function consumeClaimable(address) external returns (uint256, uint256);
    // caller=FEE_VAULT; executionDelay=0; stateDelay=0
    function consumeClaimableAssets(address, uint8) external returns (uint256, uint256);
    // caller=FEE_VAULT; executionDelay=0; stateDelay=0
    function restoreUserMemeRewards(address, uint256) external;
}

interface ITickerGardenMemeHookMutationDraft {
    // caller=FEE_VAULT; executionDelay=0; stateDelay=0
    function convertRewards(bytes32, uint256, uint256) external returns (uint256, uint256);
    // caller=POOL_MANAGER; executionDelay=0; stateDelay=0
    function unlockCallback(bytes calldata) external returns (bytes);
    // caller=GRADUATION_MODULE; executionDelay=0; stateDelay=0
    function registerExpectedPool(bytes32, PoolKey calldata, uint32) external returns (bytes32);
    // caller=GRADUATION_MODULE; executionDelay=0; stateDelay=0
    function activatePool(bytes32) external;
    // caller=POOL_MANAGER; executionDelay=0; stateDelay=0
    function beforeInitialize(address, PoolKey calldata, uint160) external returns (bytes4);
    // caller=POOL_MANAGER; executionDelay=0; stateDelay=0
    function afterSwap(address, PoolKey calldata, SwapParams calldata, int256, bytes calldata) external returns (bytes4, int128);
}

interface IProtocolFeeVaultMutationDraft {
    // caller=ACTIVE_FEE_SOURCE; executionDelay=0; stateDelay=0
    function beginV4Credit(bytes32, address, uint256, uint32, bytes32) external;
    // caller=ACTIVE_FEE_SOURCE; executionDelay=0; stateDelay=0
    function finalizeV4Credit(bytes32, address, uint256, uint256, uint256, uint256, uint64, bytes32) external;
    // caller=EXACT_REGISTERED_CURVE; executionDelay=0; stateDelay=0
    function beginCurveCredit(bytes32, address, uint256, uint256, uint32, uint64, bytes32) external;
    // caller=EXACT_REGISTERED_CURVE; executionDelay=0; stateDelay=0
    function finalizeCurveCredit(bytes32, address, uint256, uint256, uint32, uint64, bytes32) external payable;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function claimPlatform(bytes32, address) external returns (uint256);
    // caller=EXACT_REGISTERED_GAUGE; executionDelay=0; stateDelay=0
    function recordForfeiture(bytes32, address, uint256, uint256) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function fundHolderRewards(bytes32, uint32) external returns (uint256);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function claimUserRewards(bytes32, uint8, uint32, bool, bool, uint256) external returns (uint256, uint256, uint256);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function claimUserRewardAssets(bytes32, uint8, uint32, uint8, bool, bool, uint256) external returns (uint256, uint256, uint256);
    // caller=FEE_VAULT; executionDelay=0; stateDelay=0
    function convertUserClaim(bytes32, MarketView calldata, uint256, uint256) external returns (uint256, uint256);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function fundHolderMemeRewards(bytes32) external returns (uint256);
}

interface IGraduationExecutorMutationDraft {
    // caller=EXACT_REGISTERED_CURVE; executionDelay=0; stateDelay=0
    function graduateFromCurve(bytes32, uint256, uint256) external payable;
}

interface ICreatorRevenueRegistryMutationDraft {
    // caller=FACTORY_MODULE; executionDelay=0; stateDelay=0
    function initializeCreatorRevenueEpoch(bytes32, address) external;
    // caller=CURRENT_CREATOR_BENEFICIARY; executionDelay=0; stateDelay=0
    function transferCreatorRevenueBeneficiary(bytes32, address) external returns (uint32);
    // caller=PENDING_CREATOR_REVENUE_BENEFICIARY; executionDelay=0; stateDelay=0
    function acceptCreatorRevenueBeneficiary(bytes32) external returns (uint32);
    // caller=CURRENT_CREATOR_BENEFICIARY; executionDelay=0; stateDelay=0
    function cancelCreatorRevenueBeneficiaryTransfer(bytes32) external;
}
