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
    IMarketRegistryV1,
    IOfficialStockRegistryV1,
    IPonsBaselineRegistry,
    ITickerGardenFactoryV1,
    MarketConfig
} from "../interfaces/IV1Protocol.sol";
import {MemeStockGauge} from "./MemeStockGauge.sol";
import {CurveInitialization, ICurveInitializationSource, PonsCompatibleCurve} from "./PonsCompatibleCurve.sol";
import {TickerMemeTokenV1} from "./TickerMemeTokenV1.sol";
import {V1Create2} from "../shared/V1Create2.sol";
import {V1FactoryValidation} from "../shared/V1FactoryValidation.sol";
import {V1Identifiers} from "../shared/V1Identifiers.sol";
import {V1MarketEconomics} from "../shared/V1MarketEconomics.sol";
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
    address launchRouter;
    address platformTreasury;
    address treasuryDistributor;
    address memeTokenImplementation;
    address curveImplementation;
    address gaugeImplementation;
    bytes32 feePolicyId;
}

struct TickerMemeTokenV1Init {
    bytes32 marketId;
    address creator;
    address predictedCurve;
    address treasuryDistributor;
    string name;
    string symbol;
    string metadataURI;
    uint256 initialSupply;
}

interface IFactoryMarketRegistryDependencies {
    function factory() external view returns (address);
    function officialStockRegistry() external view returns (address);
    function approvedQuoteRegistry() external view returns (address);
    function ponsBaselineRegistry() external view returns (address);
    function launchTemplateRegistry() external view returns (address);
    function graduationExecutor() external view returns (address);
}

interface IFactoryCreatorRevenueDependencies {
    function factory() external view returns (address);
    function marketRegistry() external view returns (address);
}

/// @dev A code-identity anchor and fixed deployment delegate target. Delegatecall keeps the Factory as the
///      CREATE2 deployer while avoiding a Factory runtime that embeds every component's creation code.
contract TickerMemeTokenV1Implementation {
    function initCodeHash(TickerMemeTokenV1Init memory init) external pure returns (bytes32) {
        return V1Create2.initCodeHash(
            type(TickerMemeTokenV1).creationCode,
            abi.encode(
                init.marketId,
                init.creator,
                init.predictedCurve,
                init.treasuryDistributor,
                init.name,
                init.symbol,
                init.metadataURI,
                init.initialSupply
            )
        );
    }

    function deploy(bytes32 salt, TickerMemeTokenV1Init memory init) external payable returns (address) {
        return V1Create2.deploy(
            salt,
            bytes.concat(
                type(TickerMemeTokenV1).creationCode,
                abi.encode(
                    init.marketId,
                    init.creator,
                    init.predictedCurve,
                    init.treasuryDistributor,
                    init.name,
                    init.symbol,
                    init.metadataURI,
                    init.initialSupply
                )
            )
        );
    }
}

/// @dev See TickerMemeTokenV1Implementation. Curve creation code only binds the Factory; its market snapshot is
///      exposed transiently by the Factory during construction, breaking the Token/Curve prediction cycle.
contract PonsCompatibleCurveImplementation {
    function initCodeHash(address factory) external pure returns (bytes32) {
        return V1Create2.initCodeHash(type(PonsCompatibleCurve).creationCode, abi.encode(factory));
    }

    function deploy(bytes32 salt) external payable returns (address) {
        return V1Create2.deploy(salt, bytes.concat(type(PonsCompatibleCurve).creationCode, abi.encode(address(this))));
    }
}

/// @notice Canonical V1 launch Factory with atomic CREATE2 component deployment and Registry admission.
contract TickerGardenFactoryV1 is ITickerGardenFactoryV1, ICurveInitializationSource, ReentrancyGuard {
    uint256 public immutable override launchFee;

    IOfficialStockRegistryV1 public immutable officialStockRegistry;
    IApprovedQuoteRegistry public immutable approvedQuoteRegistry;
    IPonsBaselineRegistry public immutable ponsBaselineRegistry;
    ILaunchTemplateRegistry public immutable launchTemplateRegistry;
    IMarketRegistryV1 public immutable marketRegistry;
    address public immutable override creatorRevenueRegistry;
    address public immutable protocolFeeVault;
    address public immutable allocationManager;
    address public immutable launchRouter;
    address public immutable platformTreasury;
    address public immutable override treasuryDistributor;
    bytes32 public immutable feePolicyId;

    address public immutable memeTokenImplementation;
    address public immutable curveImplementation;
    address public immutable gaugeImplementation;

    V1FactoryValidation.Policy private _policy;
    address private _initializingCurve;
    CurveInitialization private _curveInitialization;
    mapping(bytes32 marketId => bool reserved) private _reservedMarketIds;

    uint256 private constant LAUNCH_FEE = 500_000_000_000_000;
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-9");
    bytes32 private constant TOKEN_IMPLEMENTATION_CODEHASH =
        0x5a1ea402d301c312d0df4cc719db06d8f03830df83ec2073299d41d02df9cbb5;
    bytes32 private constant CURVE_IMPLEMENTATION_CODEHASH =
        0x6feec146597292da0639e2a762521b2515507640092f19038224d8af20b5b749;
    bytes32 private constant GAUGE_IMPLEMENTATION_CODEHASH =
        0x4b43e05c2cca68728b2b1a65bf7469639d5f6dc6dd4132e4519484a0a75cc3f9;

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

        officialStockRegistry = IOfficialStockRegistryV1(init.officialStockRegistry);
        approvedQuoteRegistry = IApprovedQuoteRegistry(init.approvedQuoteRegistry);
        ponsBaselineRegistry = IPonsBaselineRegistry(init.ponsBaselineRegistry);
        launchTemplateRegistry = ILaunchTemplateRegistry(init.launchTemplateRegistry);
        marketRegistry = IMarketRegistryV1(init.marketRegistry);
        creatorRevenueRegistry = init.creatorRevenueRegistry;
        protocolFeeVault = init.protocolFeeVault;
        allocationManager = init.allocationManager;
        launchRouter = init.launchRouter;
        platformTreasury = init.platformTreasury;
        treasuryDistributor = init.treasuryDistributor;
        feePolicyId = init.feePolicyId;
        launchFee = LAUNCH_FEE;

        memeTokenImplementation = init.memeTokenImplementation;
        curveImplementation = init.curveImplementation;
        gaugeImplementation = init.gaugeImplementation;

        _policy.feePolicyId = init.feePolicyId;
        _policy.fields = V1MarketEconomics.FeePolicyInput({
            executionSpecId: EXECUTION_SPEC_ID,
            feePips: 10_000,
            lpShareBps: 0,
            poolKeyFee: 0,
            hookPermissionMask: 0x2044,
            feeAssetMode: 1,
            stakerNonLpShareBps: 3_000,
            platformNonLpShareBps: 3_000
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
        return _createMarket(V1FactoryValidation.directCreator(msg.sender), params);
    }

    function createMarketFor(address creator, CreateMarketParams calldata params)
        external
        payable
        override
        nonReentrant
        returns (bytes32 marketId, address memeToken, address curve, address gauge)
    {
        return _createMarket(V1FactoryValidation.routedCreator(msg.sender, launchRouter, creator), params);
    }

    function previewMarketEconomics(CreateMarketParams calldata params) external view override returns (bytes32) {
        V1FactoryValidation.Snapshot memory snapshot = _resolve(msg.sender, params);
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
        V1FactoryValidation.Snapshot memory snapshot = _resolve(creator, params);
        V1FactoryValidation.validateExpected(snapshot, params.expectedEconomics);
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
        V1FactoryValidation.Snapshot memory snapshot = _resolve(creator, params);
        V1FactoryValidation.validateExpected(snapshot, params.expectedEconomics);
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
                    (_componentSalt(marketId, V1Identifiers.ComponentKind.CURVE))
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
        V1FactoryValidation.Snapshot memory snapshot
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
            graduatedHook: snapshot.template.graduatedHook
        });
        marketRegistry.registerMarket(marketId, config);
        ICreatorRevenueRegistry(creatorRevenueRegistry)
            .initializeCreatorRevenueEpoch(marketId, params.creatorRevenueBeneficiary);
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
        TickerMemeTokenV1Init memory init = _tokenInit(marketId, creator, curve, params, supply);
        bytes memory callData = abi.encodeCall(
            TickerMemeTokenV1Implementation.deploy, (_componentSalt(marketId, V1Identifiers.ComponentKind.TOKEN), init)
        );
        _requireAddress(expectedToken, _delegateDeploy(memeTokenImplementation, callData));
    }

    function _prepareCurveInitialization(
        bytes32 marketId,
        address creator,
        address memeToken,
        address curve,
        CreateMarketParams calldata params,
        V1FactoryValidation.Snapshot memory snapshot
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
            quoteAsset: quoteAsset,
            memeToken: memeToken
        });
        address deployed = MemeStockGaugeClone.deployDeterministic(
            gaugeImplementation, _componentSalt(marketId, V1Identifiers.ComponentKind.GAUGE), identity
        );
        _requireAddress(expectedGauge, deployed);
        _requireGaugeIdentity(deployed, identity);
    }

    function _predict(address creator, CreateMarketParams calldata params, V1FactoryValidation.Snapshot memory snapshot)
        private
        view
        returns (bytes32 marketId, address memeToken, address curve, address gauge, address launchLocker)
    {
        _requireTemplateImplementations(snapshot);
        marketId = V1Identifiers.hashMarketId(
            V1Identifiers.MarketIdStringInput({
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
        return V1Create2.predict(
            address(this),
            _componentSalt(marketId, V1Identifiers.ComponentKind.CURVE),
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
        return V1Create2.predict(
            address(this),
            _componentSalt(marketId, V1Identifiers.ComponentKind.TOKEN),
            TickerMemeTokenV1Implementation(memeTokenImplementation)
                .initCodeHash(_tokenInit(marketId, creator, curve, params, supply))
        );
    }

    function _tokenInit(
        bytes32 marketId,
        address creator,
        address curve,
        CreateMarketParams calldata params,
        uint256 supply
    ) private view returns (TickerMemeTokenV1Init memory) {
        return TickerMemeTokenV1Init({
            marketId: marketId,
            creator: creator,
            predictedCurve: curve,
            treasuryDistributor: treasuryDistributor,
            name: params.name,
            symbol: params.symbol,
            metadataURI: params.metadataURI,
            initialSupply: supply
        });
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
            quoteAsset: quoteAsset,
            memeToken: memeToken
        });
        MemeStockGaugeClone.validatePrediction(identity);
        return MemeStockGaugeClone.predictDeterministicAddress(
            gaugeImplementation, _componentSalt(marketId, V1Identifiers.ComponentKind.GAUGE), identity, address(this)
        );
    }

    function _resolve(address creator, CreateMarketParams calldata params)
        private
        view
        returns (V1FactoryValidation.Snapshot memory)
    {
        return V1FactoryValidation.resolve(
            V1FactoryValidation.Registries({
                officialStock: officialStockRegistry,
                approvedQuote: approvedQuoteRegistry,
                ponsBaseline: ponsBaselineRegistry,
                launchTemplate: launchTemplateRegistry
            }),
            _policy,
            address(this),
            address(marketRegistry),
            allocationManager,
            creator,
            params
        );
    }

    function _requireTemplateImplementations(V1FactoryValidation.Snapshot memory snapshot) private view {
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

    function _componentSalt(bytes32 marketId, V1Identifiers.ComponentKind kind) private view returns (bytes32) {
        return V1Identifiers.componentSalt(block.chainid, address(this), marketId, kind);
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
            init.launchRouter,
            init.platformTreasury,
            init.treasuryDistributor,
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
                || revenue.factory() != address(this) || revenue.marketRegistry() != init.marketRegistry
        ) revert InvalidFactoryBinding();
    }
}
