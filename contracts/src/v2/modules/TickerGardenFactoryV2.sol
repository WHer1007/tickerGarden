// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {
    CreateMarketParams,
    GaugeIdentity,
    IApprovedQuoteRegistry,
    ICreatorRevenueRegistry,
    IGraduationExecutor,
    ILaunchTemplateRegistry,
    IMarketRegistryV2,
    IOfficialStockRegistryV2,
    IPonsBaselineRegistry,
    ITickerGardenFactoryV2,
    MarketConfig
} from "../interfaces/IV2Protocol.sol";
import {MemeStockGauge} from "./MemeStockGauge.sol";
import {CurveInitialization, ICurveInitializationSource, PonsCompatibleCurve} from "./PonsCompatibleCurve.sol";
import {TickerMemeTokenV2} from "./TickerMemeTokenV2.sol";
import {V2Create2} from "../shared/V2Create2.sol";
import {V2FactoryValidation} from "../shared/V2FactoryValidation.sol";
import {V2Identifiers} from "../shared/V2Identifiers.sol";
import {V2MarketEconomics} from "../shared/V2MarketEconomics.sol";
import {MemeStockGaugeClone} from "../shared/MemeStockGaugeClone.sol";

struct TickerGardenFactoryInit {
    address officialStockRegistry;
    address approvedQuoteRegistry;
    address ponsBaselineRegistry;
    address launchTemplateRegistry;
    address marketRegistry;
    address creatorRevenueRegistry;
    address protocolFeeVault;
    address allocationManager;
    address marketController;
    address launchRouter;
    address platformTreasury;
    address memeTokenImplementation;
    address curveImplementation;
    address gaugeImplementation;
    bytes32 feePolicyId;
}

interface IFactoryMarketRegistryDependencies {
    function factory() external view returns (address);
    function officialStockRegistry() external view returns (address);
    function approvedQuoteRegistry() external view returns (address);
    function ponsBaselineRegistry() external view returns (address);
    function launchTemplateRegistry() external view returns (address);
    function graduationExecutor() external view returns (address);
    function marketController() external view returns (address);
}

interface IFactoryCreatorRevenueDependencies {
    function factory() external view returns (address);
    function marketRegistry() external view returns (address);
}

/// @dev A code-identity anchor and fixed deployment delegate target. Delegatecall keeps the Factory as the
///      CREATE2 deployer while avoiding a Factory runtime that embeds every component's creation code.
contract TickerMemeTokenV2Implementation {
    function initCodeHash(
        bytes32 marketId,
        address creator,
        address predictedCurve,
        string memory name,
        string memory symbol,
        string memory metadataURI,
        uint256 initialSupply
    ) external pure returns (bytes32) {
        return V2Create2.initCodeHash(
            type(TickerMemeTokenV2).creationCode,
            abi.encode(marketId, creator, predictedCurve, name, symbol, metadataURI, initialSupply)
        );
    }

    function deploy(
        bytes32 salt,
        bytes32 marketId,
        address creator,
        address predictedCurve,
        string memory name,
        string memory symbol,
        string memory metadataURI,
        uint256 initialSupply
    ) external payable returns (address) {
        return V2Create2.deploy(
            salt,
            bytes.concat(
                type(TickerMemeTokenV2).creationCode,
                abi.encode(marketId, creator, predictedCurve, name, symbol, metadataURI, initialSupply)
            )
        );
    }
}

/// @dev See TickerMemeTokenV2Implementation. Curve creation code only binds the Factory; its market snapshot is
///      exposed transiently by the Factory during construction, breaking the Token/Curve prediction cycle.
contract PonsCompatibleCurveImplementation {
    function initCodeHash(address factory) external pure returns (bytes32) {
        return V2Create2.initCodeHash(type(PonsCompatibleCurve).creationCode, abi.encode(factory));
    }

    function deploy(bytes32 salt) external payable returns (address) {
        return V2Create2.deploy(salt, bytes.concat(type(PonsCompatibleCurve).creationCode, abi.encode(address(this))));
    }
}

/// @notice Canonical V2 launch Factory with atomic CREATE2 component deployment and Registry admission.
contract TickerGardenFactoryV2 is ITickerGardenFactoryV2, ICurveInitializationSource, ReentrancyGuard {
    uint256 public immutable override launchFee;

    IOfficialStockRegistryV2 public immutable officialStockRegistry;
    IApprovedQuoteRegistry public immutable approvedQuoteRegistry;
    IPonsBaselineRegistry public immutable ponsBaselineRegistry;
    ILaunchTemplateRegistry public immutable launchTemplateRegistry;
    IMarketRegistryV2 public immutable marketRegistry;
    ICreatorRevenueRegistry public immutable creatorRevenueRegistry;
    address public immutable protocolFeeVault;
    address public immutable allocationManager;
    address public immutable marketController;
    address public immutable launchRouter;
    address public immutable platformTreasury;
    bytes32 public immutable feePolicyId;

    address public immutable memeTokenImplementation;
    address public immutable curveImplementation;
    address public immutable gaugeImplementation;

    V2FactoryValidation.Policy private _policy;
    address private _initializingCurve;
    CurveInitialization private _curveInitialization;
    mapping(bytes32 marketId => bool reserved) private _reservedMarketIds;

    uint256 private constant LAUNCH_FEE = 500_000_000_000_000;
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V2-EXEC-5");
    bytes32 private constant TOKEN_IMPLEMENTATION_CODEHASH =
        0xe0450cdd47a6df268a83fa9270bd30e90daca35b99181dabe2a456a0d1eac7db;
    bytes32 private constant CURVE_IMPLEMENTATION_CODEHASH =
        0x5359d9b7b1ab5be416e512d044a3abf1a2b92126c27dcb68237693aa8cfda521;
    bytes32 private constant GAUGE_IMPLEMENTATION_CODEHASH =
        0xec124b5080eef06176e9d5c7209bf504d4ad5737eb802e85144849213bb86ae8;

    error InvalidFactoryDependency(address dependency);
    error InvalidComponentImplementation(address implementation, bytes32 expectedHash, bytes32 actualHash);
    error InvalidFactoryBinding();
    error InvalidLaunchFee(uint256 expected, uint256 actual);
    error MarketIdentityAlreadyReserved(bytes32 marketId);
    error LaunchTemplateImplementationMismatch(address expected, address supplied);
    error InvalidPredictedLaunchLocker(address launchLocker);
    error ComponentDeploymentCallFailed(address implementation, bytes reason);
    error ComponentAddressMismatch(address expected, address actual);
    error GaugeIdentityMismatch(address gauge, bytes32 expectedHash, bytes32 actualHash);
    error CurveInitializationUnavailable(address curve);
    error LaunchFeeTransferFailed(address treasury, uint256 amount);

    constructor(TickerGardenFactoryInit memory init) {
        _validateDependencies(init);

        officialStockRegistry = IOfficialStockRegistryV2(init.officialStockRegistry);
        approvedQuoteRegistry = IApprovedQuoteRegistry(init.approvedQuoteRegistry);
        ponsBaselineRegistry = IPonsBaselineRegistry(init.ponsBaselineRegistry);
        launchTemplateRegistry = ILaunchTemplateRegistry(init.launchTemplateRegistry);
        marketRegistry = IMarketRegistryV2(init.marketRegistry);
        creatorRevenueRegistry = ICreatorRevenueRegistry(init.creatorRevenueRegistry);
        protocolFeeVault = init.protocolFeeVault;
        allocationManager = init.allocationManager;
        marketController = init.marketController;
        launchRouter = init.launchRouter;
        platformTreasury = init.platformTreasury;
        feePolicyId = init.feePolicyId;
        launchFee = LAUNCH_FEE;

        memeTokenImplementation = init.memeTokenImplementation;
        curveImplementation = init.curveImplementation;
        gaugeImplementation = init.gaugeImplementation;

        _policy.feePolicyId = init.feePolicyId;
        _policy.fields = V2MarketEconomics.FeePolicyInput({
            executionSpecId: EXECUTION_SPEC_ID,
            feePips: 10_000,
            lpShareBps: 2_000,
            poolKeyFee: 0,
            hookPermissionMask: 0x2044,
            feeAssetMode: 1,
            stakerNonLpShareBps: 5_000
        });

        _validateBindings(init);
    }

    function createMarket(CreateMarketParams calldata params)
        external
        payable
        override
        nonReentrant
        returns (bytes32 marketId, address memeToken, address curve, address gauge)
    {
        return _createMarket(V2FactoryValidation.directCreator(msg.sender), params);
    }

    function createMarketFor(address creator, CreateMarketParams calldata params)
        external
        payable
        override
        nonReentrant
        returns (bytes32 marketId, address memeToken, address curve, address gauge)
    {
        return _createMarket(V2FactoryValidation.routedCreator(msg.sender, launchRouter, creator), params);
    }

    function previewMarketEconomics(CreateMarketParams calldata params) external view override returns (bytes32) {
        V2FactoryValidation.Snapshot memory snapshot = _resolve(msg.sender, params);
        return snapshot.expectedEconomics;
    }

    /// @notice Returns the immutable trust roots needed by read-only clients to
    /// bind API projections back to canonical onchain records.
    function runtimeBindings()
        external
        view
        override
        returns (
            address officialStockRegistry_,
            address approvedQuoteRegistry_,
            address ponsBaselineRegistry_,
            address launchTemplateRegistry_,
            address marketRegistry_,
            address protocolFeeVault_,
            address allocationManager_,
            address launchRouter_
        )
    {
        return (
            address(officialStockRegistry),
            address(approvedQuoteRegistry),
            address(ponsBaselineRegistry),
            address(launchTemplateRegistry),
            address(marketRegistry),
            protocolFeeVault,
            allocationManager,
            launchRouter
        );
    }

    function predictMarketAddresses(address creator, CreateMarketParams calldata params)
        external
        view
        override
        returns (bytes32 marketId, address memeToken, address curve, address gauge, address launchLocker)
    {
        V2FactoryValidation.Snapshot memory snapshot = _resolve(creator, params);
        V2FactoryValidation.validateExpected(snapshot, params.expectedEconomics);
        return _predict(creator, params, snapshot);
    }

    function curveInitialization(address curve) external view override returns (CurveInitialization memory) {
        if (msg.sender != curve || curve != _initializingCurve) revert CurveInitializationUnavailable(curve);
        return _curveInitialization;
    }

    function _createMarket(address creator, CreateMarketParams calldata params)
        private
        returns (bytes32 marketId, address memeToken, address curve, address gauge)
    {
        if (msg.value != launchFee) revert InvalidLaunchFee(launchFee, msg.value);
        V2FactoryValidation.Snapshot memory snapshot = _resolve(creator, params);
        V2FactoryValidation.validateExpected(snapshot, params.expectedEconomics);
        (marketId, memeToken, curve, gauge,) = _predict(creator, params, snapshot);
        if (_reservedMarketIds[marketId]) revert MarketIdentityAlreadyReserved(marketId);
        _reservedMarketIds[marketId] = true;

        _deployToken(marketId, creator, curve, memeToken, params, snapshot.baseline.supply);

        _prepareCurveInitialization(marketId, creator, memeToken, curve, params, snapshot);
        _requireAddress(
            curve,
            _delegateDeploy(
                curveImplementation,
                abi.encodeCall(
                    PonsCompatibleCurveImplementation.deploy,
                    (_componentSalt(marketId, V2Identifiers.ComponentKind.CURVE))
                )
            )
        );
        delete _curveInitialization;
        _initializingCurve = address(0);

        _deployGauge(marketId, memeToken, gauge, params, snapshot.quote.quoteAsset);

        _registerAndFinalize(marketId, memeToken, curve, gauge, params, snapshot);
    }

    function _registerAndFinalize(
        bytes32 marketId,
        address memeToken,
        address curve,
        address gauge,
        CreateMarketParams calldata params,
        V2FactoryValidation.Snapshot memory snapshot
    ) private {
        MarketConfig memory config = MarketConfig({
            assetUid: params.assetUid,
            ponsBaselineId: params.ponsBaselineId,
            quoteAssetConfigId: params.quoteAssetConfigId,
            launchTemplateId: params.launchTemplateId,
            feePolicyId: feePolicyId,
            executionSpecId: EXECUTION_SPEC_ID,
            expectedEconomics: snapshot.expectedEconomics,
            launchConfigId: snapshot.baseline.launchConfigId,
            creatorRevenueBeneficiaryAtCreation: params.creatorRevenueBeneficiary,
            memeToken: memeToken,
            curve: curve,
            gauge: gauge,
            quoteAsset: snapshot.quote.quoteAsset,
            graduatedHook: snapshot.template.graduatedHook,
            marketController: marketController
        });
        marketRegistry.registerMarket(marketId, config);
        creatorRevenueRegistry.initializeCreatorRevenueEpoch(marketId, params.creatorRevenueBeneficiary);
        _transferLaunchFee();

        emit MarketCreated(
            marketId,
            params.assetUid,
            memeToken,
            curve,
            gauge,
            snapshot.quote.quoteAsset,
            params.ponsBaselineId,
            params.quoteAssetConfigId,
            snapshot.expectedEconomics
        );
    }

    function _deployToken(
        bytes32 marketId,
        address creator,
        address curve,
        address expectedToken,
        CreateMarketParams calldata params,
        uint256 supply
    ) private {
        bytes memory callData = abi.encodeCall(
            TickerMemeTokenV2Implementation.deploy,
            (
                _componentSalt(marketId, V2Identifiers.ComponentKind.TOKEN),
                marketId,
                creator,
                curve,
                params.name,
                params.symbol,
                params.metadataURI,
                supply
            )
        );
        _requireAddress(expectedToken, _delegateDeploy(memeTokenImplementation, callData));
    }

    function _prepareCurveInitialization(
        bytes32 marketId,
        address creator,
        address memeToken,
        address curve,
        CreateMarketParams calldata params,
        V2FactoryValidation.Snapshot memory snapshot
    ) private {
        _initializingCurve = curve;
        _curveInitialization = CurveInitialization({
            marketId: marketId,
            ponsBaselineId: params.ponsBaselineId,
            quoteAssetConfigId: params.quoteAssetConfigId,
            marketRegistry: address(marketRegistry),
            protocolFeeVault: protocolFeeVault,
            graduationExecutor: snapshot.template.graduationExecutor,
            launchRouter: launchRouter,
            creator: creator,
            beneficiaryAtCreation: params.creatorRevenueBeneficiary,
            memeToken: memeToken,
            quoteAsset: snapshot.quote.quoteAsset,
            phantomQuote: snapshot.quote.phantomQuote,
            graduationThreshold: snapshot.quote.graduationThreshold,
            initialSupply: snapshot.baseline.supply,
            curveFeeBps: snapshot.baseline.curveFeeBps
        });
    }

    function _deployGauge(
        bytes32 marketId,
        address memeToken,
        address expectedGauge,
        CreateMarketParams calldata params,
        address quoteAsset
    ) private {
        GaugeIdentity memory identity = GaugeIdentity({
            marketId: marketId,
            assetUid: params.assetUid,
            quoteAssetConfigId: params.quoteAssetConfigId,
            allocationManager: allocationManager,
            protocolFeeVault: protocolFeeVault,
            marketController: marketController,
            quoteAsset: quoteAsset,
            memeToken: memeToken
        });
        address deployed = MemeStockGaugeClone.deployDeterministic(
            gaugeImplementation, _componentSalt(marketId, V2Identifiers.ComponentKind.GAUGE), identity
        );
        _requireAddress(expectedGauge, deployed);
        _requireGaugeIdentity(deployed, identity);
    }

    function _predict(address creator, CreateMarketParams calldata params, V2FactoryValidation.Snapshot memory snapshot)
        private
        view
        returns (bytes32 marketId, address memeToken, address curve, address gauge, address launchLocker)
    {
        _requireTemplateImplementations(snapshot);
        marketId = V2Identifiers.hashMarketId(
            V2Identifiers.MarketIdStringInput({
                chainId: block.chainid,
                factory: address(this),
                creator: creator,
                creatorRevenueBeneficiaryAtCreation: params.creatorRevenueBeneficiary,
                creatorSalt: params.salt,
                expectedEconomics: snapshot.expectedEconomics,
                name: params.name,
                symbol: params.symbol,
                metadataURI: params.metadataURI
            })
        );

        curve = _predictCurve(marketId);
        memeToken = _predictToken(marketId, creator, curve, params, snapshot.baseline.supply);
        gauge = _predictGauge(marketId, memeToken, params, snapshot.quote.quoteAsset);
        launchLocker = IGraduationExecutor(snapshot.template.graduationExecutor).predictLaunchLocker(marketId);
        if (launchLocker == address(0) || launchLocker.code.length != 0) {
            revert InvalidPredictedLaunchLocker(launchLocker);
        }
    }

    function _predictCurve(bytes32 marketId) private view returns (address) {
        return V2Create2.predict(
            address(this),
            _componentSalt(marketId, V2Identifiers.ComponentKind.CURVE),
            PonsCompatibleCurveImplementation(curveImplementation).initCodeHash(address(this))
        );
    }

    function _predictToken(
        bytes32 marketId,
        address creator,
        address curve,
        CreateMarketParams calldata params,
        uint256 supply
    ) private view returns (address) {
        return V2Create2.predict(
            address(this),
            _componentSalt(marketId, V2Identifiers.ComponentKind.TOKEN),
            TickerMemeTokenV2Implementation(memeTokenImplementation)
                .initCodeHash(marketId, creator, curve, params.name, params.symbol, params.metadataURI, supply)
        );
    }

    function _predictGauge(bytes32 marketId, address memeToken, CreateMarketParams calldata params, address quoteAsset)
        private
        view
        returns (address)
    {
        GaugeIdentity memory identity = GaugeIdentity({
            marketId: marketId,
            assetUid: params.assetUid,
            quoteAssetConfigId: params.quoteAssetConfigId,
            allocationManager: allocationManager,
            protocolFeeVault: protocolFeeVault,
            marketController: marketController,
            quoteAsset: quoteAsset,
            memeToken: memeToken
        });
        MemeStockGaugeClone.validatePrediction(identity);
        return MemeStockGaugeClone.predictDeterministicAddress(
            gaugeImplementation, _componentSalt(marketId, V2Identifiers.ComponentKind.GAUGE), identity, address(this)
        );
    }

    function _resolve(address creator, CreateMarketParams calldata params)
        private
        view
        returns (V2FactoryValidation.Snapshot memory)
    {
        return V2FactoryValidation.resolve(
            V2FactoryValidation.Registries({
                officialStock: officialStockRegistry,
                approvedQuote: approvedQuoteRegistry,
                ponsBaseline: ponsBaselineRegistry,
                launchTemplate: launchTemplateRegistry
            }),
            _policy,
            address(this),
            creator,
            params
        );
    }

    function _requireTemplateImplementations(V2FactoryValidation.Snapshot memory snapshot) private view {
        if (snapshot.template.memeTokenImplementation != memeTokenImplementation) {
            revert LaunchTemplateImplementationMismatch(
                memeTokenImplementation, snapshot.template.memeTokenImplementation
            );
        }
        if (snapshot.template.curveImplementation != curveImplementation) {
            revert LaunchTemplateImplementationMismatch(curveImplementation, snapshot.template.curveImplementation);
        }
        if (snapshot.template.gaugeImplementation != gaugeImplementation) {
            revert LaunchTemplateImplementationMismatch(gaugeImplementation, snapshot.template.gaugeImplementation);
        }
        IFactoryMarketRegistryDependencies registry = IFactoryMarketRegistryDependencies(address(marketRegistry));
        if (snapshot.template.graduationExecutor != registry.graduationExecutor()) revert InvalidFactoryBinding();
    }

    function _componentSalt(bytes32 marketId, V2Identifiers.ComponentKind kind) private view returns (bytes32) {
        return V2Identifiers.componentSalt(block.chainid, address(this), marketId, kind);
    }

    function _delegateDeploy(address implementation, bytes memory callData) private returns (address deployed) {
        (bool success, bytes memory result) = implementation.delegatecall(callData);
        if (!success) revert ComponentDeploymentCallFailed(implementation, result);
        deployed = abi.decode(result, (address));
    }

    function _requireAddress(address expected, address actual) private pure {
        if (actual != expected) revert ComponentAddressMismatch(expected, actual);
    }

    function _requireGaugeIdentity(address gauge, GaugeIdentity memory expected) private view {
        GaugeIdentity memory actual = MemeStockGauge(gauge).gaugeIdentity();
        bytes32 expectedHash = MemeStockGaugeClone.identityHash(expected);
        bytes32 actualHash = MemeStockGaugeClone.identityHash(actual);
        if (actualHash != expectedHash) revert GaugeIdentityMismatch(gauge, expectedHash, actualHash);
    }

    function _transferLaunchFee() private {
        (bool success,) = payable(platformTreasury).call{value: launchFee}("");
        if (!success) revert LaunchFeeTransferFailed(platformTreasury, launchFee);
    }

    function _validateDependencies(TickerGardenFactoryInit memory init) private view {
        address[14] memory dependencies = [
            init.officialStockRegistry,
            init.approvedQuoteRegistry,
            init.ponsBaselineRegistry,
            init.launchTemplateRegistry,
            init.marketRegistry,
            init.creatorRevenueRegistry,
            init.protocolFeeVault,
            init.allocationManager,
            init.marketController,
            init.launchRouter,
            init.platformTreasury,
            init.memeTokenImplementation,
            init.curveImplementation,
            init.gaugeImplementation
        ];
        for (uint256 i; i < dependencies.length; ++i) {
            if (dependencies[i] == address(0) || dependencies[i].code.length == 0) {
                revert InvalidFactoryDependency(dependencies[i]);
            }
        }
        if (init.feePolicyId == bytes32(0)) revert InvalidFactoryDependency(address(0));
        _requireImplementation(init.memeTokenImplementation, TOKEN_IMPLEMENTATION_CODEHASH);
        _requireImplementation(init.curveImplementation, CURVE_IMPLEMENTATION_CODEHASH);
        _requireImplementation(init.gaugeImplementation, GAUGE_IMPLEMENTATION_CODEHASH);
    }

    function _requireImplementation(address implementation, bytes32 expectedHash) private view {
        bytes32 actualHash = implementation.codehash;
        if (actualHash != expectedHash) {
            revert InvalidComponentImplementation(implementation, expectedHash, actualHash);
        }
    }

    function _validateBindings(TickerGardenFactoryInit memory init) private view {
        IFactoryMarketRegistryDependencies registry = IFactoryMarketRegistryDependencies(init.marketRegistry);
        IFactoryCreatorRevenueDependencies revenue = IFactoryCreatorRevenueDependencies(init.creatorRevenueRegistry);
        if (
            registry.factory() != address(this) || registry.officialStockRegistry() != init.officialStockRegistry
                || registry.approvedQuoteRegistry() != init.approvedQuoteRegistry
                || registry.ponsBaselineRegistry() != init.ponsBaselineRegistry
                || registry.launchTemplateRegistry() != init.launchTemplateRegistry
                || registry.marketController() != init.marketController || revenue.factory() != address(this)
                || revenue.marketRegistry() != init.marketRegistry
        ) revert InvalidFactoryBinding();
    }
}
