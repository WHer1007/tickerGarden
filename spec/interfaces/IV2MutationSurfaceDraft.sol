// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// GENERATED DRAFT: do not implement against this file before V2-M0 closes.
// Source: v2_abi_surface.json + v2_permissions_matrix.json

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

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
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

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IOfficialStockRegistryV2MutationDraft {
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function registerAsset(bytes32, address, uint8, address, uint256) external;
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
    // caller=PAUSE_GUARDIAN_ROLE; executionDelay=0; stateDelay=0
    function pauseQuote(bytes32, bytes32) external;
    // caller=UNPAUSE_ROLE; executionDelay=86400; stateDelay=0
    function unpauseQuote(bytes32) external;
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function retireQuote(bytes32, bytes32) external;
}

interface IPonsBaselineRegistryMutationDraft {
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function addBaseline(bytes32, PonsBaseline calldata) external;
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

interface ITickerGardenFactoryV2MutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function createMarket(CreateMarketParams calldata) external payable returns (bytes32, address, address, address);
    // caller=LAUNCH_ROUTER_MODULE; executionDelay=0; stateDelay=0
    function createMarketFor(address, CreateMarketParams calldata) external payable returns (bytes32, address, address, address);
}

interface IMarketRegistryV2MutationDraft {
    // caller=FACTORY_MODULE; executionDelay=0; stateDelay=0
    function registerMarket(bytes32, MarketConfig calldata) external;
    // caller=EXACT_REGISTERED_CURVE; executionDelay=0; stateDelay=0
    function markSwept(bytes32) external;
    // caller=GRADUATION_MODULE; executionDelay=0; stateDelay=0
    function commitPoolCreated(bytes32, bytes32) external returns (uint32);
    // caller=GRADUATION_MODULE; executionDelay=0; stateDelay=604800
    function markRescued(bytes32) external;
    // caller=MARKET_CONTROLLER; executionDelay=0; stateDelay=0
    function setMarketPaused(bytes32, bytes32) external;
    // caller=MARKET_CONTROLLER; executionDelay=0; stateDelay=0
    function setMarketActive(bytes32) external;
    // caller=MARKET_CONTROLLER; executionDelay=0; stateDelay=0
    function setMarketRetired(bytes32, bytes32) external;
    // caller=MARKET_CONTROLLER; executionDelay=0; stateDelay=0
    function commitEmergencyExit(bytes32, uint64, bytes32) external returns (uint32);
}

interface ILaunchAndBuyRouterMutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function launchAndBuy(CreateMarketParams calldata, uint256, uint256, address) external payable returns (bytes32, address, uint256, uint256);
}

interface ITickerMemeTokenV2MutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function transfer(address, uint256) external returns (bool);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function approve(address, uint256) external returns (bool);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IPonsCompatibleCurveMutationDraft {
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
    function forceReleaseAllocation(bytes32, bytes32) external returns (uint256);
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function lockAllocation(bytes32, address, bytes32, uint256) external;
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function releaseAllocation(bytes32, address, bytes32) external returns (uint256);
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function rageQuitAllocation(bytes32, address, bytes32) external returns (uint256);
}

interface IAllocationManagerMutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function allocate(bytes32, uint256) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function increaseAllocation(bytes32, uint256) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function closeAllocation(bytes32) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function rageQuit(bytes32) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function depositAndAllocate(bytes32, uint256, uint256) external;
}

interface IMemeStockGaugeMutationDraft {
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function addPending(address, uint256, uint64, uint64) external;
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function removeAllocation(address) external returns (uint256);
    // caller=ALLOCATION_MODULE; executionDelay=0; stateDelay=0
    function rageQuit(address) external returns (uint256, uint256, uint256, bool);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function checkpointActivations() external returns (uint256, uint256);
    // caller=ALLOCATION_MODULE_OR_FEE_VAULT; executionDelay=0; stateDelay=0
    function settle(address) external;
    // caller=FEE_VAULT; executionDelay=0; stateDelay=0
    function creditStakerFee(address, uint256, bytes32) external returns (uint256, uint256);
    // caller=FEE_VAULT; executionDelay=0; stateDelay=0
    function consumeClaimable(address, address) external returns (uint256);
    // caller=MARKET_CONTROLLER; executionDelay=0; stateDelay=0
    function disableForEmergency(uint32, uint64, bytes32) external;
}

interface ITickerGardenMemeHookMutationDraft {
    // caller=GRADUATION_MODULE; executionDelay=0; stateDelay=0
    function registerExpectedPool(bytes32, PoolKey calldata, uint32) external returns (bytes32);
    // caller=GRADUATION_MODULE; executionDelay=0; stateDelay=0
    function activatePool(bytes32) external;
    // caller=MARKET_CONTROLLER; executionDelay=0; stateDelay=0
    function disablePool(bytes32) external;
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
    function creditCurveSweep(bytes32, address, uint256, uint32, uint64, bytes32) external payable;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function claimCreator(bytes32, uint32, address) external returns (uint256);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function claimPlatform(bytes32, address) external returns (uint256);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function claimStaker(bytes32, address) external returns (uint256);
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function claimStakerFor(address, bytes32, address) external returns (uint256);
    // caller=EXACT_REGISTERED_GAUGE; executionDelay=0; stateDelay=0
    function recordForfeiture(bytes32, address, uint256, uint256) external;
    // caller=MARKET_CONTROLLER; executionDelay=0; stateDelay=0
    function freezeRecoveryCaps(bytes32, uint32, uint64, bytes32) external returns (uint256, uint256);
    // caller=RECOVERY_ROLE; executionDelay=86400; stateDelay=0
    function proposeRecoveryRoot(bytes32, uint32, address, bytes32, uint256) external returns (uint32, uint64);
    // caller=PAUSE_GUARDIAN_ROLE; executionDelay=0; stateDelay=0
    function cancelRecoveryRoot(bytes32, uint32, address, uint32) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=172800
    function finalizeRecoveryRoot(bytes32, uint32, address, uint32) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function claimRecovery(bytes32, uint32, address, uint256, bytes32[] calldata) external;
}

interface IMarketControllerMutationDraft {
    // caller=PAUSE_GUARDIAN_ROLE; executionDelay=0; stateDelay=0
    function pauseMarket(bytes32, bytes32) external;
    // caller=UNPAUSE_ROLE; executionDelay=86400; stateDelay=0
    function unpauseMarket(bytes32) external;
    // caller=PROTOCOL_ADMIN_ROLE; executionDelay=172800; stateDelay=0
    function retireMarket(bytes32, bytes32) external;
    // caller=RECOVERY_ROLE; executionDelay=86400; stateDelay=86400
    function activateEmergencyExit(bytes32) external returns (uint32, uint64, bytes32);
}

interface IGraduationExecutorMutationDraft {
    // caller=EXACT_REGISTERED_CURVE; executionDelay=0; stateDelay=0
    function graduateFromCurve(bytes32) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function retryGraduation(bytes32) external;
    // caller=PUBLIC; executionDelay=0; stateDelay=604800
    function rescueSweptLaunch(bytes32) external;
}

interface ILaunchLockerMutationDraft {
    // caller=PUBLIC; executionDelay=0; stateDelay=0
    function compoundLockedFees() external returns (uint256, uint256, uint128);
}

interface ICreatorRevenueRegistryMutationDraft {
    // caller=FACTORY_MODULE; executionDelay=0; stateDelay=0
    function initializeCreatorRevenueEpoch(bytes32, address) external;
    // caller=CURRENT_CREATOR_BENEFICIARY; executionDelay=0; stateDelay=0
    function transferCreatorRevenueBeneficiary(bytes32, address) external returns (uint32);
}
