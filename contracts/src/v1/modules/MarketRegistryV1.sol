// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AssetView,
    CanonicalRoute,
    IApprovedQuoteRegistry,
    IGraduationExecutor,
    ILaunchLocker,
    ILaunchTemplateRegistry,
    IMarketRegistryV1,
    IOfficialStockRegistryV1,
    IPonsBaselineRegistry,
    LaunchTemplate,
    MarketConfig,
    MarketRuntime,
    MarketView,
    PonsBaseline,
    PoolKey,
    QuoteAssetConfig
} from "../interfaces/IV1Protocol.sol";

/// @notice Canonical immutable market snapshots, semantic transitions, and discovery for TickerGarden V1.
contract MarketRegistryV1 is IMarketRegistryV1 {
    uint8 internal constant LAUNCH_PHASE_NOT_GRADUATED = 0;
    uint8 internal constant LAUNCH_PHASE_SWEPT = 1;
    uint8 internal constant LAUNCH_PHASE_POOL_CREATED = 2;
    uint8 internal constant LAUNCH_PHASE_RESCUED = 3;
    uint8 internal constant CONFIG_STATUS_ACTIVE = 1;
    uint160 internal constant REQUIRED_HOOK_PERMISSION_MASK = 0x2044;
    uint64 internal constant RESCUE_DELAY_SECONDS = 7 days;

    bytes32 public constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-8");

    address public immutable factory;
    address public immutable officialStockRegistry;
    address public immutable approvedQuoteRegistry;
    address public immutable ponsBaselineRegistry;
    address public immutable launchTemplateRegistry;
    address public immutable graduationExecutor;
    address public immutable swapRouter;
    address public immutable quoter;

    mapping(bytes32 marketId => MarketConfig config) private _marketConfigs;
    mapping(bytes32 marketId => MarketRuntime runtime) private _marketRuntimes;
    mapping(bytes32 marketId => bool registered) private _registeredMarkets;
    mapping(address memeToken => bytes32 marketId) private _marketIdsByToken;

    error ZeroConstructorAddress();
    error UnauthorizedFactory(address caller);
    error MarketNotRegistered(bytes32 marketId);
    error MarketAlreadyRegistered(bytes32 marketId);
    error MemeTokenAlreadyRegistered(address memeToken, bytes32 marketId);
    error InvalidMarketConfig();
    error InvalidExecutionSpecId(bytes32 supplied);
    error InvalidPonsBaseline(bytes32 baselineId);
    error InvalidCanonicalPoolKey();
    error BlockTimestampOverflow(uint256 timestamp);
    error UnauthorizedMarketCurve(address caller, address expectedCurve);
    error UnauthorizedModule(address caller, address expectedModule);
    error InvalidStateTransition(uint8 currentState, uint8 requestedState);
    error InactiveFeeSource(bytes32 marketId, uint32 sourceVersion);
    error PoolNotExpected(bytes32 poolId);
    error GraduationNotRetryable(bytes32 marketId, uint8 launchPhase);
    error RescueDelayNotElapsed(uint64 readyAt);
    error InvalidRoutingDependencies(address swapRouter, address quoter);
    error InvalidCanonicalRoute(bytes32 marketId);

    constructor(
        address factory_,
        address officialStockRegistry_,
        address approvedQuoteRegistry_,
        address ponsBaselineRegistry_,
        address launchTemplateRegistry_,
        address graduationExecutor_,
        address swapRouter_,
        address quoter_
    ) {
        if (
            factory_ == address(0) || officialStockRegistry_ == address(0) || approvedQuoteRegistry_ == address(0)
                || ponsBaselineRegistry_ == address(0) || launchTemplateRegistry_ == address(0)
                || graduationExecutor_ == address(0)
        ) {
            revert ZeroConstructorAddress();
        }
        if (
            swapRouter_.code.length == 0 || quoter_.code.length == 0 || swapRouter_ == quoter_
                || swapRouter_ == graduationExecutor_ || quoter_ == graduationExecutor_
        ) revert InvalidRoutingDependencies(swapRouter_, quoter_);
        factory = factory_;
        officialStockRegistry = officialStockRegistry_;
        approvedQuoteRegistry = approvedQuoteRegistry_;
        ponsBaselineRegistry = ponsBaselineRegistry_;
        launchTemplateRegistry = launchTemplateRegistry_;
        graduationExecutor = graduationExecutor_;
        swapRouter = swapRouter_;
        quoter = quoter_;
    }

    function registerMarket(bytes32 marketId, MarketConfig calldata config) external override {
        if (msg.sender != factory) revert UnauthorizedFactory(msg.sender);
        if (_registeredMarkets[marketId]) revert MarketAlreadyRegistered(marketId);
        _validateConfig(marketId, config);

        bytes32 tokenMarketId = _marketIdsByToken[config.memeToken];
        if (tokenMarketId != bytes32(0)) {
            revert MemeTokenAlreadyRegistered(config.memeToken, tokenMarketId);
        }
        _registeredMarkets[marketId] = true;
        _marketConfigs[marketId] = config;
        _marketRuntimes[marketId] =
            MarketRuntime({poolId: bytes32(0), sourceVersion: 1, sweptAt: 0, launchPhase: LAUNCH_PHASE_NOT_GRADUATED});
        _marketIdsByToken[config.memeToken] = marketId;

        emit MarketRegistered(marketId, config.assetUid, config.memeToken, config.curve, config.gauge, 1);
    }

    function markSwept(bytes32 marketId) external override {
        _requireRegistered(marketId);
        MarketConfig storage config = _marketConfigs[marketId];
        if (msg.sender != config.curve) revert UnauthorizedMarketCurve(msg.sender, config.curve);
        MarketRuntime storage runtime = _marketRuntimes[marketId];
        if (runtime.launchPhase != LAUNCH_PHASE_NOT_GRADUATED) {
            revert InvalidStateTransition(runtime.launchPhase, LAUNCH_PHASE_SWEPT);
        }

        runtime.launchPhase = LAUNCH_PHASE_SWEPT;
        runtime.sweptAt = _currentTimestamp();
        emit LaunchPhaseChanged(
            marketId, LAUNCH_PHASE_NOT_GRADUATED, LAUNCH_PHASE_SWEPT, runtime.sweptAt, bytes32(0), runtime.sourceVersion
        );
    }

    function commitPoolCreated(bytes32 marketId, bytes32 poolId) external override returns (uint32 sourceVersion) {
        _requireGraduationExecutor();
        _requireRegistered(marketId);
        MarketRuntime storage runtime = _marketRuntimes[marketId];
        if (runtime.launchPhase != LAUNCH_PHASE_SWEPT) {
            revert InvalidStateTransition(runtime.launchPhase, LAUNCH_PHASE_POOL_CREATED);
        }
        if (poolId == bytes32(0) || poolId != _canonicalPoolId(marketId)) revert PoolNotExpected(poolId);

        runtime.launchPhase = LAUNCH_PHASE_POOL_CREATED;
        runtime.poolId = poolId;
        sourceVersion = ++runtime.sourceVersion;
        emit LaunchPhaseChanged(
            marketId, LAUNCH_PHASE_SWEPT, LAUNCH_PHASE_POOL_CREATED, runtime.sweptAt, poolId, sourceVersion
        );
    }

    function markRescued(bytes32 marketId) external override {
        _requireGraduationExecutor();
        _requireRegistered(marketId);
        MarketRuntime storage runtime = _marketRuntimes[marketId];
        if (runtime.launchPhase != LAUNCH_PHASE_SWEPT) {
            revert GraduationNotRetryable(marketId, runtime.launchPhase);
        }
        uint64 readyAt = _checkedReadyAt(runtime.sweptAt, RESCUE_DELAY_SECONDS);
        if (block.timestamp < readyAt) revert RescueDelayNotElapsed(readyAt);

        runtime.launchPhase = LAUNCH_PHASE_RESCUED;
        emit LaunchPhaseChanged(
            marketId, LAUNCH_PHASE_SWEPT, LAUNCH_PHASE_RESCUED, runtime.sweptAt, bytes32(0), runtime.sourceVersion
        );
    }

    function market(bytes32 marketId) external view override returns (MarketView memory) {
        _requireRegistered(marketId);
        return MarketView({config: _marketConfigs[marketId], runtime: _marketRuntimes[marketId]});
    }

    function marketIdByToken(address memeToken) external view override returns (bytes32) {
        return _marketIdsByToken[memeToken];
    }

    function canonicalPoolKey(bytes32 marketId) public view override returns (PoolKey memory key) {
        _requireRegistered(marketId);
        MarketConfig storage config = _marketConfigs[marketId];
        PonsBaseline memory baseline = IPonsBaselineRegistry(ponsBaselineRegistry).baseline(config.ponsBaselineId);
        _validatePoolBaseline(config.ponsBaselineId, config.launchConfigId, baseline);

        (address currency0, address currency1) = config.quoteAsset < config.memeToken
            ? (config.quoteAsset, config.memeToken)
            : (config.memeToken, config.quoteAsset);
        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 0,
            tickSpacing: baseline.tickSpacing,
            hooks: config.graduatedHook
        });
    }

    function canonicalPoolId(bytes32 marketId) external view override returns (bytes32) {
        return _canonicalPoolId(marketId);
    }

    function canonicalRoute(bytes32 marketId) external view override returns (CanonicalRoute memory route) {
        _requireRegistered(marketId);
        MarketConfig storage config = _marketConfigs[marketId];
        MarketRuntime storage runtime = _marketRuntimes[marketId];
        PoolKey memory key = canonicalPoolKey(marketId);
        bytes32 poolId = keccak256(abi.encode(key));
        address launchLocker = IGraduationExecutor(graduationExecutor).predictLaunchLocker(marketId);
        if (
            launchLocker == address(0) || key.hooks != config.graduatedHook || config.quoteAsset == config.memeToken
                || (runtime.poolId != bytes32(0) && runtime.poolId != poolId)
        ) revert InvalidCanonicalRoute(marketId);

        bool poolTradingEnabled = runtime.launchPhase == LAUNCH_PHASE_POOL_CREATED;
        if (runtime.launchPhase == LAUNCH_PHASE_POOL_CREATED) {
            if (runtime.poolId != poolId || launchLocker.code.length == 0) revert InvalidCanonicalRoute(marketId);
            try ILaunchLocker(launchLocker).marketId() returns (bytes32 lockerMarketId) {
                if (lockerMarketId != marketId) revert InvalidCanonicalRoute(marketId);
            } catch {
                revert InvalidCanonicalRoute(marketId);
            }
            try ILaunchLocker(launchLocker).lockedPosition() returns (uint256 tokenId, bytes32 lockedPoolId) {
                if (tokenId == 0 || lockedPoolId != poolId) revert InvalidCanonicalRoute(marketId);
            } catch {
                revert InvalidCanonicalRoute(marketId);
            }
        }

        route = CanonicalRoute({
            poolKey: key,
            poolId: poolId,
            swapRouter: swapRouter,
            quoter: quoter,
            hook: config.graduatedHook,
            quoteAsset: config.quoteAsset,
            memeToken: config.memeToken,
            gauge: config.gauge,
            curve: config.curve,
            launchLocker: launchLocker,
            sourceVersion: runtime.sourceVersion,
            launchPhase: runtime.launchPhase,
            curveTradingEnabled: runtime.launchPhase == LAUNCH_PHASE_NOT_GRADUATED,
            poolTradingEnabled: poolTradingEnabled
        });
    }

    function activeFeeSource(bytes32 marketId) external view override returns (address source, uint32 sourceVersion) {
        _requireRegistered(marketId);
        MarketRuntime storage runtime = _marketRuntimes[marketId];
        if (runtime.launchPhase == LAUNCH_PHASE_NOT_GRADUATED) {
            source = _marketConfigs[marketId].curve;
            sourceVersion = runtime.sourceVersion;
        } else if (runtime.launchPhase == LAUNCH_PHASE_POOL_CREATED) {
            source = _marketConfigs[marketId].graduatedHook;
            sourceVersion = runtime.sourceVersion;
        }
    }

    function _validateConfig(bytes32 marketId, MarketConfig calldata config) private view {
        if (
            marketId == bytes32(0) || config.assetUid == bytes32(0) || config.ponsBaselineId == bytes32(0)
                || config.quoteAssetConfigId == bytes32(0) || config.launchTemplateId == bytes32(0)
                || config.feePolicyId == bytes32(0) || config.expectedEconomics == bytes32(0)
                || config.creatorRevenueBeneficiaryAtCreation == address(0) || config.memeToken == address(0)
                || config.curve == address(0) || config.gauge == address(0) || config.graduatedHook == address(0)
        ) revert InvalidMarketConfig();
        if (config.executionSpecId != EXECUTION_SPEC_ID) {
            revert InvalidExecutionSpecId(config.executionSpecId);
        }
        if (config.quoteAsset == config.memeToken) revert InvalidCanonicalPoolKey();
        if (uint160(config.graduatedHook) & 0x3fff != REQUIRED_HOOK_PERMISSION_MASK) {
            revert InvalidCanonicalPoolKey();
        }

        AssetView memory asset = IOfficialStockRegistryV1(officialStockRegistry).asset(config.assetUid);
        if (
            asset.status != CONFIG_STATUS_ACTIVE || asset.stockToken == address(0) || asset.userStockVault == address(0)
                || asset.tokenDecimals < 6 || asset.tokenDecimals > 18
                || !IOfficialStockRegistryV1(officialStockRegistry).assetIdentityCurrent(config.assetUid)
        ) revert InvalidMarketConfig();

        QuoteAssetConfig memory quote =
            IApprovedQuoteRegistry(approvedQuoteRegistry).quoteConfig(config.quoteAssetConfigId);
        if (
            quote.status != CONFIG_STATUS_ACTIVE || quote.ponsBaselineId != config.ponsBaselineId
                || quote.quoteAsset != config.quoteAsset || quote.economicsHash != config.quoteAssetConfigId
        ) revert InvalidMarketConfig();

        PonsBaseline memory baseline = IPonsBaselineRegistry(ponsBaselineRegistry).baseline(config.ponsBaselineId);
        _validatePoolBaseline(config.ponsBaselineId, config.launchConfigId, baseline);
        if (baseline.status != CONFIG_STATUS_ACTIVE) revert InvalidPonsBaseline(config.ponsBaselineId);

        LaunchTemplate memory template =
            ILaunchTemplateRegistry(launchTemplateRegistry).launchTemplate(config.launchTemplateId);
        if (
            template.status != CONFIG_STATUS_ACTIVE || template.feePolicyId != config.feePolicyId
                || template.executionSpecId != config.executionSpecId || template.graduatedHook != config.graduatedHook
                || template.graduationExecutor != graduationExecutor
        ) revert InvalidMarketConfig();
    }

    function _validatePoolBaseline(bytes32 baselineId, uint256 launchConfigId, PonsBaseline memory baseline)
        private
        pure
    {
        if (
            baseline.launchConfigId != launchConfigId || baseline.poolFee != 0 || baseline.tickSpacing < 1
                || baseline.tickSpacing > 32_767
        ) revert InvalidPonsBaseline(baselineId);
    }

    function _requireRegistered(bytes32 marketId) private view {
        if (!_registeredMarkets[marketId]) revert MarketNotRegistered(marketId);
    }

    function _requireGraduationExecutor() private view {
        if (msg.sender != graduationExecutor) revert UnauthorizedModule(msg.sender, graduationExecutor);
    }

    function _canonicalPoolId(bytes32 marketId) private view returns (bytes32) {
        return keccak256(abi.encode(canonicalPoolKey(marketId)));
    }

    function _currentTimestamp() private view returns (uint64 timestamp) {
        if (block.timestamp > type(uint64).max) revert BlockTimestampOverflow(block.timestamp);
        timestamp = uint64(block.timestamp);
    }

    function _checkedReadyAt(uint64 startedAt, uint64 delaySeconds) private pure returns (uint64 readyAt) {
        uint256 result = uint256(startedAt) + delaySeconds;
        if (result > type(uint64).max) revert BlockTimestampOverflow(result);
        readyAt = uint64(result);
    }
}
