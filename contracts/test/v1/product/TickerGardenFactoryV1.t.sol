// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Errors} from "@openzeppelin/contracts/utils/Errors.sol";

import {
    AssetView,
    CreateMarketParams,
    GaugeIdentity,
    ICreatorRevenueRegistry,
    ILaunchAndBuyRouter,
    IMarketRegistryV1,
    ITickerGardenFactoryV1,
    LaunchTemplate,
    MarketView,
    PonsBaseline,
    PositionView,
    QuoteAssetConfig
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {CreatorRevenueRegistry} from "../../../src/v1/modules/CreatorRevenueRegistry.sol";
import {LaunchAndBuyRouter} from "../../../src/v1/modules/LaunchAndBuyRouter.sol";
import {MarketRegistryV1} from "../../../src/v1/modules/MarketRegistryV1.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {PonsCompatibleCurve} from "../../../src/v1/modules/PonsCompatibleCurve.sol";
import {TickerMemeTokenV1} from "../../../src/v1/modules/TickerMemeTokenV1.sol";
import {
    PonsCompatibleCurveImplementation,
    TickerGardenFactoryInit,
    TickerGardenFactoryV1,
    TickerMemeTokenV1Init,
    TickerMemeTokenV1Implementation
} from "../../../src/v1/modules/TickerGardenFactoryV1.sol";
import {MemeStockGaugeClone} from "../../../src/v1/shared/MemeStockGaugeClone.sol";
import {V1FactoryValidation} from "../../../src/v1/shared/V1FactoryValidation.sol";
import {V1Create2} from "../../../src/v1/shared/V1Create2.sol";
import {V1Identifiers} from "../../../src/v1/shared/V1Identifiers.sol";
import {LaunchAndBuyRouterERC20} from "../../../src/v1/shared/LaunchAndBuyRouterERC20.sol";
import {LaunchAndBuyRouterNative} from "../../../src/v1/shared/LaunchAndBuyRouterNative.sol";
import {
    MockCallbackQuoteToken,
    MockExactQuoteToken,
    MockFeeOnTransferQuoteToken,
    MockReturnAnomalyQuoteToken
} from "../mocks/MockV1QuoteAssets.sol";

contract FactoryConfigRegistryMock {
    mapping(bytes32 => AssetView) private _assets;
    mapping(bytes32 => QuoteAssetConfig) private _quotes;
    mapping(bytes32 => PonsBaseline) private _baselines;
    mapping(bytes32 => LaunchTemplate) private _templates;
    mapping(bytes32 => bytes32) private _templateHashes;
    mapping(address => bytes32) private _vaultSchemaIds;
    mapping(bytes32 => address) private _vaultsBySchema;
    bool private _quoteIdentityIsCurrent = true;

    function setAsset(bytes32 id, AssetView memory value) external {
        _assets[id] = value;
    }

    function setQuote(bytes32 id, QuoteAssetConfig memory value) external {
        _quotes[id] = value;
    }

    function setQuoteIdentityCurrent(bool current) external {
        _quoteIdentityIsCurrent = current;
    }

    function setBaseline(bytes32 id, PonsBaseline memory value) external {
        _baselines[id] = value;
    }

    function setTemplate(bytes32 id, LaunchTemplate memory value, bytes32 contentHash) external {
        _templates[id] = value;
        _templateHashes[id] = contentHash;
    }

    function setVaultSchema(address vault, bytes32 schemaId) external {
        _vaultSchemaIds[vault] = schemaId;
        _vaultsBySchema[schemaId] = vault;
    }

    function asset(bytes32 id) external view returns (AssetView memory) {
        return _assets[id];
    }

    /// @dev Test fixture default: identity is stable unless explicitly modeled by a dedicated mock.
    function assetIdentityCurrent(bytes32) external pure returns (bool) {
        return true;
    }

    function vaultSchemaId(address vault) external view returns (bytes32) {
        return _vaultSchemaIds[vault];
    }

    function vaultForSchema(bytes32 schemaId) external view returns (address) {
        return _vaultsBySchema[schemaId];
    }

    function quoteConfig(bytes32 id) external view returns (QuoteAssetConfig memory) {
        return _quotes[id];
    }

    function quoteIdentityCurrent(bytes32) external view returns (bool) {
        return _quoteIdentityIsCurrent;
    }

    function baseline(bytes32 id) external view returns (PonsBaseline memory) {
        return _baselines[id];
    }

    function launchTemplate(bytes32 id) external view returns (LaunchTemplate memory) {
        return _templates[id];
    }

    function launchTemplateHash(bytes32 id) external view returns (bytes32) {
        return _templateHashes[id];
    }
}

contract FactoryDependencyMock {
    address private _vaultRegistry;
    address private _vaultMarketRegistry;
    address private _vaultAllocationManager;
    bytes32 private _vaultSchemaId;

    function setVaultIdentity(address registry, address marketRegistry, address allocationManager, bytes32 schemaId)
        external
    {
        _vaultRegistry = registry;
        _vaultMarketRegistry = marketRegistry;
        _vaultAllocationManager = allocationManager;
        _vaultSchemaId = schemaId;
    }

    function vaultIdentity() external view returns (address, address, address, bytes32) {
        return (_vaultRegistry, _vaultMarketRegistry, _vaultAllocationManager, _vaultSchemaId);
    }

    function rageQuitRewardCutoff(bytes32, address) external pure returns (uint256, uint256, uint256, bool) {
        return (0, 0, 0, false);
    }
}

contract FactoryCurveFeeVaultMock {
    uint256 public credited;

    function beginCurveCredit(bytes32, address, uint256, uint32, uint64, bytes32) external {}

    function finalizeCurveCredit(bytes32, address quoteAsset, uint256 amount, uint32, uint64, bytes32)
        external
        payable
    {
        require(msg.value == (quoteAsset == address(0) ? amount : 0), "INVALID_SWEEP_VALUE");
        credited += amount;
    }
}

contract FactoryGraduationExecutorMock {
    IMarketRegistryV1 public marketRegistry;

    receive() external payable {}

    function setMarketRegistry(IMarketRegistryV1 value) external {
        require(address(marketRegistry) == address(0), "REGISTRY_ALREADY_SET");
        marketRegistry = value;
    }

    function predictLaunchLocker(bytes32 marketId) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encode("LOCKER", address(this), marketId)))));
    }

    function graduateFromCurve(bytes32 marketId, uint256 quoteAmount, uint256) external payable {
        MarketView memory value = marketRegistry.market(marketId);
        require(value.config.curve == msg.sender, "INVALID_CURVE");
        require(msg.value == (value.config.quoteAsset == address(0) ? quoteAmount : 0), "INVALID_VALUE");
        marketRegistry.commitPoolCreated(marketId, keccak256(abi.encode(marketRegistry.canonicalPoolKey(marketId))));
    }
}

contract FactoryTreasuryMock {
    bool public reject;

    function setReject(bool value) external {
        reject = value;
    }

    receive() external payable {
        require(!reject, "TREASURY_REJECTED");
    }
}

contract FactoryToggleApproveQuoteToken {
    uint8 public constant decimals = 6;
    bool public failApprove;
    address public rejectedTransferRecipient;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function setFailApprove(bool value) external {
        failApprove = value;
    }

    function setRejectedTransferRecipient(address recipient) external {
        rejectedTransferRecipient = recipient;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (failApprove) return false;
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external virtual returns (bool) {
        if (recipient == rejectedTransferRecipient) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount) public virtual returns (bool) {
        allowance[owner][msg.sender] -= amount;
        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract FactoryReentrantQuoteToken is FactoryToggleApproveQuoteToken {
    LaunchAndBuyRouter public immutable router;
    bool public attack;

    constructor(LaunchAndBuyRouter router_) {
        router = router_;
    }

    function setAttack(bool value) external {
        attack = value;
    }

    function transferFrom(address owner, address recipient, uint256 amount) public override returns (bool) {
        bool success = super.transferFrom(owner, recipient, amount);
        if (attack) {
            CreateMarketParams memory emptyParams;
            router.launchAndBuy(emptyParams, 1, 0, address(1));
        }
        return success;
    }
}

contract FactoryRejectingCreator {
    receive() external payable {
        revert("REFUND_REJECTED");
    }

    function launch(
        LaunchAndBuyRouter router,
        CreateMarketParams calldata params,
        uint256 firstBuyAmount,
        address recipient
    ) external payable {
        router.launchAndBuy{value: msg.value}(params, firstBuyAmount, 0, recipient);
    }
}

contract FactoryRouterCaller {
    function launch(
        LaunchAndBuyRouter router,
        CreateMarketParams calldata params,
        uint256 firstBuyAmount,
        uint256 minTokensOut,
        address recipient
    ) external payable returns (bytes32, address, uint256, uint256) {
        return router.launchAndBuy{value: msg.value}(params, firstBuyAmount, minTokensOut, recipient);
    }
}

contract FactoryAddressDeployer {
    function deploy(TickerGardenFactoryInit memory init) external returns (TickerGardenFactoryV1) {
        return new TickerGardenFactoryV1(init);
    }
}

contract TickerGardenFactoryV1Test is Test {
    bytes32 internal constant ASSET_UID = keccak256("factory-stock");
    bytes32 internal constant BASELINE_ID = keccak256("factory-baseline");
    bytes32 internal constant QUOTE_ID = keccak256("factory-quote");
    bytes32 internal constant TEMPLATE_ID = keccak256("factory-template");
    bytes32 internal constant TEMPLATE_HASH = keccak256("factory-template-content");
    bytes32 internal constant FEE_POLICY_ID = keccak256("factory-fee-policy");
    bytes32 internal constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-9");
    bytes32 internal constant VAULT_SCHEMA_ID = keccak256("TickerGarden.UserStockVault.MultiAsset.v6");
    uint256 internal constant LAUNCH_FEE = 500_000_000_000_000;
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    address internal constant CREATOR = address(0xCAFE);
    address internal constant BENEFICIARY = address(0xBEEF);

    FactoryConfigRegistryMock internal configs;
    FactoryDependencyMock internal stockVault;
    FactoryCurveFeeVaultMock internal feeVault;
    FactoryDependencyMock internal allocationManager;
    FactoryDependencyMock internal lockerImplementation;
    FactoryGraduationExecutorMock internal graduation;
    FactoryTreasuryMock internal treasury;
    LaunchAndBuyRouter internal router;
    TickerMemeTokenV1Implementation internal tokenImplementation;
    PonsCompatibleCurveImplementation internal curveImplementation;
    MemeStockGauge internal gaugeImplementation;
    MockExactQuoteToken internal stock;
    MockExactQuoteToken internal quote;
    MarketRegistryV1 internal marketRegistry;
    CreatorRevenueRegistry internal revenueRegistry;
    TickerGardenFactoryV1 internal factory;
    address internal hook;

    function setUp() public {
        configs = new FactoryConfigRegistryMock();
        stockVault = new FactoryDependencyMock();
        feeVault = new FactoryCurveFeeVaultMock();
        allocationManager = new FactoryDependencyMock();
        lockerImplementation = new FactoryDependencyMock();
        graduation = new FactoryGraduationExecutorMock();
        treasury = new FactoryTreasuryMock();
        FactoryAddressDeployer deployer = new FactoryAddressDeployer();
        address predictedFactory = vm.computeCreateAddress(address(deployer), 1);
        router = new LaunchAndBuyRouter(predictedFactory, address(configs));
        tokenImplementation = new TickerMemeTokenV1Implementation();
        curveImplementation = new PonsCompatibleCurveImplementation();
        gaugeImplementation = new MemeStockGauge();
        stock = new MockExactQuoteToken(18);
        quote = new MockExactQuoteToken(6);
        hook = address(0x1000000000000000000000000000000000002044);
        vm.etch(hook, hex"00");

        marketRegistry = new MarketRegistryV1(
            predictedFactory,
            address(configs),
            address(configs),
            address(configs),
            address(configs),
            address(graduation),
            address(stockVault),
            address(allocationManager)
        );
        graduation.setMarketRegistry(marketRegistry);
        revenueRegistry = new CreatorRevenueRegistry(predictedFactory, address(marketRegistry));
        factory = deployer.deploy(_factoryInit());
        assertEq(address(factory), predictedFactory);
        stockVault.setVaultIdentity(
            address(configs), address(marketRegistry), address(allocationManager), VAULT_SCHEMA_ID
        );
        configs.setVaultSchema(address(stockVault), VAULT_SCHEMA_ID);
        _setValidConfiguration(address(quote));
        vm.deal(CREATOR, 200 ether);
    }

    function test_constructorFreezesDeployableDependenciesAndLaunchFee() public view {
        (
            address officialStockRegistry_,
            address approvedQuoteRegistry_,
            address ponsBaselineRegistry_,
            address launchTemplateRegistry_,
            address marketRegistry_,
            address protocolFeeVault_,
            address allocationManager_,
            address launchRouter_
        ) = factory.runtimeBindings();
        assertEq(factory.launchFee(), LAUNCH_FEE);
        assertEq(officialStockRegistry_, address(configs));
        assertEq(approvedQuoteRegistry_, address(configs));
        assertEq(ponsBaselineRegistry_, address(configs));
        assertEq(launchTemplateRegistry_, address(configs));
        assertEq(marketRegistry_, address(marketRegistry));
        assertEq(protocolFeeVault_, address(feeVault));
        assertEq(allocationManager_, address(allocationManager));
        assertEq(launchRouter_, address(router));
        assertEq(factory.memeTokenImplementation(), address(tokenImplementation));
        assertEq(factory.curveImplementation(), address(curveImplementation));
        assertEq(factory.gaugeImplementation(), address(gaugeImplementation));
        assertEq(address(factory.marketRegistry()), address(marketRegistry));
        assertEq(address(factory.creatorRevenueRegistry()), address(revenueRegistry));
        assertEq(factory.platformTreasury(), address(treasury));
        assertEq(factory.treasuryDistributor(), address(treasury));
    }

    function test_predictAndCreateDeployExactComponentsAndRegisterFullSnapshot() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ONE"));
        (
            bytes32 predictedMarket,
            address predictedToken,
            address predictedCurve,
            address predictedGauge,
            address locker
        ) = factory.predictMarketAddresses(CREATOR, params);
        uint256 treasuryBefore = address(treasury).balance;

        vm.prank(CREATOR);
        (bytes32 marketId, address token, address curve, address gauge) =
            factory.createMarket{value: LAUNCH_FEE}(params);

        assertEq(marketId, predictedMarket);
        assertEq(token, predictedToken);
        assertEq(curve, predictedCurve);
        assertEq(gauge, predictedGauge);
        assertEq(locker.code.length, 0);
        assertGt(token.code.length, 0);
        assertGt(curve.code.length, 0);
        assertGt(gauge.code.length, 0);
        assertEq(address(treasury).balance, treasuryBefore + LAUNCH_FEE);

        MarketView memory value = marketRegistry.market(marketId);
        assertEq(value.config.assetUid, ASSET_UID);
        assertEq(value.config.ponsBaselineId, BASELINE_ID);
        assertEq(value.config.quoteAssetConfigId, QUOTE_ID);
        assertEq(value.config.launchTemplateId, TEMPLATE_ID);
        assertEq(value.config.feePolicyId, FEE_POLICY_ID);
        assertEq(value.config.executionSpecId, EXECUTION_SPEC_ID);
        assertEq(value.config.expectedEconomics, params.expectedEconomics);
        assertEq(value.config.creatorRevenueBeneficiaryAtCreation, BENEFICIARY);
        assertEq(value.config.memeToken, token);
        assertEq(value.config.curve, curve);
        assertEq(value.config.gauge, gauge);
        assertEq(value.config.quoteAsset, address(quote));
        assertEq(value.config.graduatedHook, hook);
        assertEq(value.runtime.sourceVersion, 1);
        assertEq(value.runtime.launchPhase, 0);
        assertEq(marketRegistry.marketIdByToken(token), marketId);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 1);
        assertEq(revenueRegistry.creatorBeneficiaryAt(marketId, 1), BENEFICIARY);
    }

    function test_realArtifactInitCodeSaltPredictionAndActualAddressMatchManifest() public {
        string memory manifest =
            vm.readFile(string.concat(vm.projectRoot(), "/../spec/v1_product_artifact_manifest.json"));
        assertEq(vm.parseJsonString(manifest, ".modules[9].module"), "MemeStockGauge");
        assertEq(vm.parseJsonString(manifest, ".modules[12].module"), "PonsCompatibleCurve");
        assertEq(vm.parseJsonString(manifest, ".modules[16].module"), "TickerMemeTokenV1");
        assertEq(
            keccak256(type(MemeStockGauge).runtimeCode),
            vm.parseJsonBytes32(manifest, ".modules[9].runtimeTemplate.keccak256")
        );
        assertEq(
            keccak256(type(PonsCompatibleCurve).creationCode),
            vm.parseJsonBytes32(manifest, ".modules[12].creationCode.keccak256")
        );
        assertEq(
            keccak256(type(TickerMemeTokenV1).creationCode),
            vm.parseJsonBytes32(manifest, ".modules[16].creationCode.keccak256")
        );

        CreateMarketParams memory params = _validParams(CREATOR, keccak256("REAL_ARTIFACT_CREATE2"));
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);

        _assertCurveCreate2(marketId, curve);
        _assertTokenCreate2(params, marketId, token, curve);
        _assertGaugeCreate2(params, marketId, token, gauge);

        vm.prank(CREATOR);
        (bytes32 actualMarketId, address actualToken, address actualCurve, address actualGauge) =
            factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(actualMarketId, marketId);
        assertEq(actualToken, token);
        assertEq(actualCurve, curve);
        assertEq(actualGauge, gauge);
        assertGt(actualToken.code.length, 0);
        assertGt(actualCurve.code.length, 0);
        assertGt(actualGauge.code.length, 0);
    }

    function _assertCurveCreate2(bytes32 marketId, address predictedCurve) private view {
        bytes32 salt =
            V1Identifiers.componentSalt(block.chainid, address(factory), marketId, V1Identifiers.ComponentKind.CURVE);
        bytes32 initCodeHash =
            V1Create2.initCodeHash(type(PonsCompatibleCurve).creationCode, abi.encode(address(factory)));
        assertEq(curveImplementation.initCodeHash(address(factory)), initCodeHash);
        assertEq(predictedCurve, V1Create2.predict(address(factory), salt, initCodeHash));
    }

    function _assertTokenCreate2(
        CreateMarketParams memory params,
        bytes32 marketId,
        address predictedToken,
        address predictedCurve
    ) private view {
        bytes32 salt = V1Identifiers.componentSalt(
            block.chainid, address(factory), marketId, V1Identifiers.ComponentKind.TOKEN
        );
        bytes32 initCodeHash = V1Create2.initCodeHash(
            type(TickerMemeTokenV1).creationCode,
            abi.encode(
                marketId,
                CREATOR,
                predictedCurve,
                address(treasury),
                params.name,
                params.symbol,
                params.metadataURI,
                SUPPLY
            )
        );
        assertEq(
            tokenImplementation.initCodeHash(
                TickerMemeTokenV1Init({
                    marketId: marketId,
                    creator: CREATOR,
                    predictedCurve: predictedCurve,
                    treasuryDistributor: address(treasury),
                    name: params.name,
                    symbol: params.symbol,
                    metadataURI: params.metadataURI,
                    initialSupply: SUPPLY
                })
            ),
            initCodeHash
        );
        assertEq(predictedToken, V1Create2.predict(address(factory), salt, initCodeHash));
    }

    function _assertGaugeCreate2(
        CreateMarketParams memory params,
        bytes32 marketId,
        address predictedToken,
        address predictedGauge
    ) private view {
        GaugeIdentity memory identity = GaugeIdentity({
            marketId: marketId,
            assetUid: params.assetUid,
            quoteAssetConfigId: params.quoteAssetConfigId,
            allocationManager: address(allocationManager),
            protocolFeeVault: address(feeVault),
            quoteAsset: address(quote),
            memeToken: predictedToken
        });
        bytes32 salt =
            V1Identifiers.componentSalt(block.chainid, address(factory), marketId, V1Identifiers.ComponentKind.GAUGE);
        assertEq(
            predictedGauge,
            MemeStockGaugeClone.predictDeterministicAddress(
                address(gaugeImplementation), salt, identity, address(factory)
            )
        );
    }

    function test_tokenCurveAndGaugeFreezeThePredictedIdentityWithoutInitializer() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("IDENTITY"));
        vm.prank(CREATOR);
        (bytes32 marketId, address tokenAddress, address curveAddress, address gaugeAddress) =
            factory.createMarket{value: LAUNCH_FEE}(params);

        TickerMemeTokenV1 token = TickerMemeTokenV1(tokenAddress);
        assertEq(token.marketId(), marketId);
        assertEq(token.creator(), CREATOR);
        assertEq(token.factory(), address(factory));
        assertEq(token.initialSupply(), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(curveAddress), SUPPLY);
        assertEq(token.balanceOf(address(factory)), 0);
        assertEq(PonsCompatibleCurve(payable(curveAddress)).quoteAsset(), address(quote));

        PositionView memory position = MemeStockGauge(gaugeAddress).positionOf(CREATOR);
        assertEq(position.activeAmount, 0);
        assertEq(position.pendingAmount, 0);
        GaugeIdentity memory identity = MemeStockGauge(gaugeAddress).gaugeIdentity();
        assertEq(identity.marketId, marketId);
        assertEq(identity.assetUid, ASSET_UID);
        assertEq(identity.quoteAssetConfigId, QUOTE_ID);
        assertEq(identity.allocationManager, address(allocationManager));
        assertEq(identity.protocolFeeVault, address(feeVault));
        assertEq(identity.quoteAsset, address(quote));
        assertEq(identity.memeToken, tokenAddress);
        (bool tokenInitializer,) = tokenAddress.call(abi.encodeWithSignature("initialize()"));
        (bool curveInitializer,) = curveAddress.call(abi.encodeWithSignature("initialize()"));
        (bool gaugeInitializer,) = gaugeAddress.call(abi.encodeWithSignature("initialize()"));
        assertFalse(tokenInitializer || curveInitializer || gaugeInitializer);
    }

    function test_marketCreatedEventExactlyMatchesReturnedAddressesAndSnapshot() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("EVENT"));
        vm.recordLogs();
        vm.prank(CREATOR);
        (bytes32 marketId, address token, address curve, address gauge) =
            factory.createMarket{value: LAUNCH_FEE}(params);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 signature =
            keccak256("MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)");
        bytes32 expectedDataHash =
            keccak256(abi.encode(curve, gauge, address(quote), BASELINE_ID, QUOTE_ID, params.expectedEconomics));
        uint256 matches;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(factory) || logs[i].topics[0] != signature) continue;
            ++matches;
            assertEq(logs[i].topics[1], marketId);
            assertEq(logs[i].topics[2], ASSET_UID);
            assertEq(address(uint160(uint256(logs[i].topics[3]))), token);
            assertEq(keccak256(logs[i].data), expectedDataHash);
        }
        assertEq(matches, 1);
    }

    function test_sameStockAndSaltCanCreateDistinctTypedMarketsButIdenticalIdentityCannotRepeat() public {
        bytes32 reusedSalt = bytes32("REUSED-SALT");
        CreateMarketParams memory first = _validParams(CREATOR, reusedSalt);
        CreateMarketParams memory second = _validParams(CREATOR, reusedSalt);
        second.name = "Ticker Garden Two";
        second.symbol = "GARDEN2";
        second.metadataURI = "ipfs://ticker-garden-two";
        vm.prank(CREATOR);
        (bytes32 firstId, address firstToken,,) = factory.createMarket{value: LAUNCH_FEE}(first);
        vm.prank(CREATOR);
        (bytes32 secondId, address secondToken,,) = factory.createMarket{value: LAUNCH_FEE}(second);
        assertNotEq(firstId, secondId);
        assertNotEq(firstToken, secondToken);
        assertEq(marketRegistry.market(firstId).config.assetUid, ASSET_UID);
        assertEq(marketRegistry.market(secondId).config.assetUid, ASSET_UID);
        assertEq(marketRegistry.marketIdByToken(firstToken), firstId);
        assertEq(marketRegistry.marketIdByToken(secondToken), secondId);

        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(TickerGardenFactoryV1.MarketIdentityAlreadyReserved.selector, firstId));
        factory.createMarket{value: LAUNCH_FEE}(first);
    }

    function test_nonFactoryWrongSupplyAndCurveDeploymentCannotSpoofCanonicalMarket() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("NON-FACTORY"));
        (bytes32 marketId, address predictedToken, address predictedCurve,,) =
            factory.predictMarketAddresses(CREATOR, params);
        address wrongCurve = address(0xBADCAFE);

        address fakeAddress = tokenImplementation.deploy(
            bytes32("OFF-PATH"),
            TickerMemeTokenV1Init({
                marketId: marketId,
                creator: CREATOR,
                predictedCurve: wrongCurve,
                treasuryDistributor: address(treasury),
                name: params.name,
                symbol: params.symbol,
                metadataURI: params.metadataURI,
                initialSupply: SUPPLY - 1
            })
        );
        TickerMemeTokenV1 fake = TickerMemeTokenV1(fakeAddress);
        assertNotEq(fakeAddress, predictedToken);
        assertEq(fake.factory(), address(tokenImplementation));
        assertEq(fake.initialSupply(), SUPPLY - 1);
        assertEq(fake.balanceOf(wrongCurve), SUPPLY - 1);
        assertEq(marketRegistry.marketIdByToken(fakeAddress), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV1.MarketNotRegistered.selector, marketId));
        marketRegistry.market(marketId);

        vm.prank(CREATOR);
        (bytes32 createdId, address canonicalToken, address canonicalCurve,) =
            factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(createdId, marketId);
        assertEq(canonicalToken, predictedToken);
        assertEq(canonicalCurve, predictedCurve);
        assertEq(TickerMemeTokenV1(canonicalToken).factory(), address(factory));
        assertEq(TickerMemeTokenV1(canonicalToken).initialSupply(), SUPPLY);
        assertEq(TickerMemeTokenV1(canonicalToken).balanceOf(canonicalCurve), SUPPLY);
    }

    function test_legacyMintCallerCannotChangeFactoryTokenSupply() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("NO-V1-MINTER"));
        vm.prank(CREATOR);
        (, address tokenAddress,,) = factory.createMarket{value: LAUNCH_FEE}(params);
        TickerMemeTokenV1 token = TickerMemeTokenV1(tokenAddress);
        uint256 supplyBefore = token.totalSupply();

        address legacyMinter = address(0xE1155100);
        vm.prank(legacyMinter);
        (bool success,) = tokenAddress.call(abi.encodeWithSignature("mint(address,uint256)", legacyMinter, 1 ether));
        assertFalse(success);
        assertEq(token.totalSupply(), supplyBefore);
        assertEq(token.balanceOf(legacyMinter), 0);
    }

    function test_launchFeeMustBeExact() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("FEE"));
        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenFactoryV1.InvalidLaunchFee.selector, LAUNCH_FEE, LAUNCH_FEE - 1)
        );
        factory.createMarket{value: LAUNCH_FEE - 1}(params);
        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenFactoryV1.InvalidLaunchFee.selector, LAUNCH_FEE, LAUNCH_FEE + 1)
        );
        factory.createMarket{value: LAUNCH_FEE + 1}(params);
    }

    function test_createMarketForIsRouterOnlyAndUsesExplicitCreatorNamespace() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTED"));
        vm.expectRevert(abi.encodeWithSelector(V1FactoryValidation.UnauthorizedLaunchRouter.selector, address(this)));
        factory.createMarketFor{value: LAUNCH_FEE}(CREATOR, params);

        (bytes32 predicted,,,,) = factory.predictMarketAddresses(CREATOR, params);
        vm.deal(address(router), LAUNCH_FEE);
        vm.prank(address(router));
        (bytes32 marketId,,,) = factory.createMarketFor{value: LAUNCH_FEE}(CREATOR, params);
        assertEq(marketId, predicted);
        assertEq(marketRegistry.market(marketId).config.creatorRevenueBeneficiaryAtCreation, BENEFICIARY);
    }

    function test_wrongEconomicsRevertsBeforeAnyAddressIsDeployed() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ECONOMICS"));
        bytes32 expected = params.expectedEconomics;
        params.expectedEconomics = bytes32(uint256(expected) ^ 1);
        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                V1FactoryValidation.ExpectedEconomicsMismatch.selector, params.expectedEconomics, expected
            )
        );
        factory.createMarket{value: LAUNCH_FEE}(params);
    }

    function test_inactiveRegistrySnapshotFailsClosed() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("INACTIVE"));
        AssetView memory asset = configs.asset(ASSET_UID);
        asset.status = 2;
        configs.setAsset(ASSET_UID, asset);
        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(V1FactoryValidation.InactiveAsset.selector, ASSET_UID, uint8(2)));
        factory.createMarket{value: LAUNCH_FEE}(params);
    }

    function test_factoryRejectsLegacyVaultSchemaBeforeMarketReservation() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("LEGACY-VAULT-SCHEMA"));
        bytes32 legacySchema = keccak256("TickerGarden.UserStockVault.MultiAsset.v5");
        configs.setVaultSchema(address(stockVault), legacySchema);

        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(
                V1FactoryValidation.InvalidVaultSchema.selector,
                ASSET_UID,
                address(stockVault),
                legacySchema,
                address(stockVault)
            )
        );

        configs.setVaultSchema(address(stockVault), VAULT_SCHEMA_ID);
        vm.prank(CREATOR);
        (bytes32 marketId,,,) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertNotEq(marketId, bytes32(0));
    }

    function test_factoryRejectsVaultDependencyIdentityDriftBeforeMarketReservation() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("VAULT-IDENTITY-DRIFT"));
        address wrongAllocationManager = address(0xBAD);
        stockVault.setVaultIdentity(address(configs), address(marketRegistry), wrongAllocationManager, VAULT_SCHEMA_ID);

        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(
                V1FactoryValidation.InvalidVaultIdentity.selector,
                ASSET_UID,
                address(stockVault),
                address(configs),
                address(marketRegistry),
                wrongAllocationManager,
                VAULT_SCHEMA_ID
            )
        );

        stockVault.setVaultIdentity(
            address(configs), address(marketRegistry), address(allocationManager), VAULT_SCHEMA_ID
        );
        vm.prank(CREATOR);
        (bytes32 marketId,,,) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertNotEq(marketId, bytes32(0));
    }

    function test_allFactoryRegistryConfigClassesFailClosedWithoutReservingIdentity() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("CONFIG-MATRIX"));

        AssetView memory asset = configs.asset(ASSET_UID);
        asset.status = 2;
        configs.setAsset(ASSET_UID, asset);
        _expectFactoryCreateRevert(
            params, abi.encodeWithSelector(V1FactoryValidation.InactiveAsset.selector, ASSET_UID, uint8(2))
        );
        _setValidConfiguration(address(quote));

        QuoteAssetConfig memory quoteConfig = configs.quoteConfig(QUOTE_ID);
        quoteConfig.status = 2;
        configs.setQuote(QUOTE_ID, quoteConfig);
        _expectFactoryCreateRevert(
            params, abi.encodeWithSelector(V1FactoryValidation.InactiveQuote.selector, QUOTE_ID, uint8(2))
        );
        _setValidConfiguration(address(quote));

        quoteConfig = configs.quoteConfig(QUOTE_ID);
        quoteConfig.economicsHash = bytes32("WRONG-QUOTE-HASH");
        configs.setQuote(QUOTE_ID, quoteConfig);
        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(
                V1FactoryValidation.InvalidQuoteEconomics.selector, QUOTE_ID, quoteConfig.economicsHash
            )
        );
        _setValidConfiguration(address(quote));

        quoteConfig = configs.quoteConfig(QUOTE_ID);
        quoteConfig.ponsBaselineId = bytes32("OTHER-BASELINE");
        configs.setQuote(QUOTE_ID, quoteConfig);
        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(
                V1FactoryValidation.QuoteBaselineMismatch.selector, quoteConfig.ponsBaselineId, BASELINE_ID
            )
        );
        _setValidConfiguration(address(quote));

        PonsBaseline memory baseline = configs.baseline(BASELINE_ID);
        baseline.status = 2;
        configs.setBaseline(BASELINE_ID, baseline);
        _expectFactoryCreateRevert(
            params, abi.encodeWithSelector(V1FactoryValidation.InactivePonsBaseline.selector, BASELINE_ID, uint8(2))
        );
        _setValidConfiguration(address(quote));

        LaunchTemplate memory template = configs.launchTemplate(TEMPLATE_ID);
        template.status = 2;
        configs.setTemplate(TEMPLATE_ID, template, TEMPLATE_HASH);
        _expectFactoryCreateRevert(
            params, abi.encodeWithSelector(V1FactoryValidation.InactiveLaunchTemplate.selector, TEMPLATE_ID, uint8(2))
        );
        _setValidConfiguration(address(quote));

        template = configs.launchTemplate(TEMPLATE_ID);
        template.feePolicyId = bytes32("WRONG-FEE-POLICY");
        configs.setTemplate(TEMPLATE_ID, template, TEMPLATE_HASH);
        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(
                V1FactoryValidation.InvalidLaunchTemplateBinding.selector,
                template.feePolicyId,
                template.executionSpecId
            )
        );
        _setValidConfiguration(address(quote));

        template = configs.launchTemplate(TEMPLATE_ID);
        template.executionSpecId = bytes32("WRONG-EXECUTION-SPEC");
        configs.setTemplate(TEMPLATE_ID, template, TEMPLATE_HASH);
        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(
                V1FactoryValidation.InvalidLaunchTemplateBinding.selector,
                template.feePolicyId,
                template.executionSpecId
            )
        );
        _setValidConfiguration(address(quote));

        template = configs.launchTemplate(TEMPLATE_ID);
        configs.setTemplate(TEMPLATE_ID, template, bytes32(0));
        _expectFactoryCreateRevert(
            params, abi.encodeWithSelector(V1FactoryValidation.InactiveLaunchTemplate.selector, TEMPLATE_ID, uint8(1))
        );
        _setValidConfiguration(address(quote));

        CreateMarketParams memory zeroBeneficiary = _validParams(CREATOR, bytes32("ZERO-BENEFICIARY"));
        zeroBeneficiary.creatorRevenueBeneficiary = address(0);
        _expectFactoryCreateRevert(
            zeroBeneficiary,
            abi.encodeWithSelector(V1FactoryValidation.InvalidCreatorRevenueBeneficiary.selector, address(0))
        );

        vm.prank(CREATOR);
        (bytes32 marketId,,,) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertNotEq(marketId, bytes32(0));
    }

    function test_unknownFactoryConfigIdsFailClosedAcrossEveryRegistry() public {
        bytes32 missingAsset = bytes32("MISSING-ASSET");
        CreateMarketParams memory missingAssetParams = _validParams(CREATOR, bytes32("UNKNOWN-ASSET"));
        missingAssetParams.assetUid = missingAsset;
        _expectFactoryCreateRevert(
            missingAssetParams,
            abi.encodeWithSelector(V1FactoryValidation.InactiveAsset.selector, missingAsset, uint8(0))
        );

        bytes32 missingQuote = bytes32("MISSING-QUOTE");
        CreateMarketParams memory missingQuoteParams = _validParams(CREATOR, bytes32("UNKNOWN-QUOTE"));
        missingQuoteParams.quoteAssetConfigId = missingQuote;
        _expectFactoryCreateRevert(
            missingQuoteParams,
            abi.encodeWithSelector(V1FactoryValidation.InactiveQuote.selector, missingQuote, uint8(0))
        );

        bytes32 missingBaseline = bytes32("MISSING-BASELINE");
        CreateMarketParams memory missingBaselineParams = _validParams(CREATOR, bytes32("UNKNOWN-BASELINE"));
        missingBaselineParams.ponsBaselineId = missingBaseline;
        QuoteAssetConfig memory quoteConfig = configs.quoteConfig(QUOTE_ID);
        quoteConfig.ponsBaselineId = missingBaseline;
        configs.setQuote(QUOTE_ID, quoteConfig);
        _expectFactoryCreateRevert(
            missingBaselineParams,
            abi.encodeWithSelector(V1FactoryValidation.InactivePonsBaseline.selector, missingBaseline, uint8(0))
        );
        _setValidConfiguration(address(quote));

        bytes32 missingTemplate = bytes32("MISSING-TEMPLATE");
        CreateMarketParams memory missingTemplateParams = _validParams(CREATOR, bytes32("UNKNOWN-TEMPLATE"));
        missingTemplateParams.launchTemplateId = missingTemplate;
        _expectFactoryCreateRevert(
            missingTemplateParams,
            abi.encodeWithSelector(V1FactoryValidation.InactiveLaunchTemplate.selector, missingTemplate, uint8(0))
        );
    }

    function test_templateMustBindTheExactDeploymentImplementations() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("TEMPLATE"));
        LaunchTemplate memory template = configs.launchTemplate(TEMPLATE_ID);
        template.gaugeImplementation = address(lockerImplementation);
        configs.setTemplate(TEMPLATE_ID, template, TEMPLATE_HASH);
        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenFactoryV1.LaunchTemplateImplementationMismatch.selector,
                address(gaugeImplementation),
                address(lockerImplementation)
            )
        );
        factory.createMarket{value: LAUNCH_FEE}(params);
    }

    function test_lateTreasuryFailureRollsBackComponentsRegistryEpochAndReservation() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROLLBACK"));
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);
        treasury.setReject(true);
        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenFactoryV1.LaunchFeeTransferFailed.selector, address(treasury), LAUNCH_FEE
            )
        );
        factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 0);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV1.MarketNotRegistered.selector, marketId));
        marketRegistry.market(marketId);

        treasury.setReject(false);
        vm.prank(CREATOR);
        (bytes32 retryId,,,) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(retryId, marketId);
    }

    function test_eachComponentDeploymentFailureRollsBackEarlierComponentsAndReservation() public {
        _assertComponentDeploymentFailureRollsBack(bytes32("TOKEN-DEPLOY-FAULT"), 0);
        _assertComponentDeploymentFailureRollsBack(bytes32("CURVE-DEPLOY-FAULT"), 1);
        _assertComponentDeploymentFailureRollsBack(bytes32("GAUGE-DEPLOY-FAULT"), 2);
    }

    function test_curveConstructorInitializationFailureRollsBackTokenAndReservation() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("CURVE-INIT-FAULT"));
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);
        uint256 treasuryBefore = address(treasury).balance;
        bytes memory injectedReason = abi.encodeWithSignature("Error(string)", "INJECTED_CURVE_INIT_FAILURE");

        vm.mockCallRevert(
            address(factory),
            abi.encodeWithSelector(TickerGardenFactoryV1.curveInitialization.selector, curve),
            injectedReason
        );
        vm.prank(CREATOR);
        vm.expectPartialRevert(TickerGardenFactoryV1.ComponentDeploymentCallFailed.selector);
        factory.createMarket{value: LAUNCH_FEE}(params);
        vm.clearMockedCalls();

        _assertLaunchRolledBack(marketId, token, curve, gauge, treasuryBefore);
        vm.prank(CREATOR);
        (bytes32 retryId,,,) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(retryId, marketId);
    }

    function test_marketRegistrationFailureRollsBackComponentsFeeEpochAndReservation() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("MARKET-REGISTER-FAULT"));
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);
        uint256 treasuryBefore = address(treasury).balance;

        vm.mockCallRevert(
            address(marketRegistry),
            abi.encodeWithSelector(IMarketRegistryV1.registerMarket.selector),
            abi.encodeWithSignature("Error(string)", "INJECTED_MARKET_REGISTRATION_FAILURE")
        );
        vm.prank(CREATOR);
        vm.expectRevert();
        factory.createMarket{value: LAUNCH_FEE}(params);
        vm.clearMockedCalls();

        _assertLaunchRolledBack(marketId, token, curve, gauge, treasuryBefore);
        vm.prank(CREATOR);
        (bytes32 retryId,,,) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(retryId, marketId);
    }

    function test_creatorEpochRegistrationFailureRollsBackMarketComponentsFeeAndReservation() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("EPOCH-REGISTER-FAULT"));
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);
        uint256 treasuryBefore = address(treasury).balance;

        vm.mockCallRevert(
            address(revenueRegistry),
            abi.encodeWithSelector(ICreatorRevenueRegistry.initializeCreatorRevenueEpoch.selector),
            abi.encodeWithSignature("Error(string)", "INJECTED_EPOCH_REGISTRATION_FAILURE")
        );
        vm.prank(CREATOR);
        vm.expectRevert();
        factory.createMarket{value: LAUNCH_FEE}(params);
        vm.clearMockedCalls();

        _assertLaunchRolledBack(marketId, token, curve, gauge, treasuryBefore);
        vm.prank(CREATOR);
        (bytes32 retryId,,,) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(retryId, marketId);
    }

    function test_curveInitializationIsUnavailableOutsideExactConstructorCallback() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("TRANSIENT"));
        (,, address curve,,) = factory.predictMarketAddresses(CREATOR, params);
        vm.expectRevert(abi.encodeWithSelector(TickerGardenFactoryV1.CurveInitializationUnavailable.selector, curve));
        factory.curveInitialization(curve);
        vm.prank(CREATOR);
        factory.createMarket{value: LAUNCH_FEE}(params);
        vm.prank(curve);
        vm.expectRevert(abi.encodeWithSelector(TickerGardenFactoryV1.CurveInitializationUnavailable.selector, curve));
        factory.curveInitialization(curve);
    }

    function test_gaugeOnlyAcceptsImmutableAllocationManager() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("GAUGE-CLOSED"));
        vm.prank(CREATOR);
        (bytes32 marketId,,, address gaugeAddress) = factory.createMarket{value: LAUNCH_FEE}(params);
        uint64 activationAt = uint64(block.timestamp + 30 seconds);
        uint64 unlockAt = uint64(block.timestamp + 24 hours);
        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGauge.UnauthorizedAllocationModule.selector, CREATOR, address(allocationManager)
            )
        );
        MemeStockGauge(gaugeAddress).addPending(CREATOR, 1 ether, activationAt, unlockAt);
        assertEq(MemeStockGauge(gaugeAddress).totalPendingStock(), 0);
    }

    function test_nativeQuoteUsesZeroAddressAndStillDeploys() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("NATIVE"));
        vm.prank(CREATOR);
        (bytes32 marketId,, address curve, address gauge) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(marketRegistry.market(marketId).config.quoteAsset, address(0));
        assertEq(PonsCompatibleCurve(payable(curve)).quoteAsset(), address(0));
        MemeStockGauge(gauge).rewardState(address(0));
    }

    function test_launchAndBuyNativeCreatesAndBuysAtomicallyForOuterCaller() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-NATIVE"));
        address recipient = address(0xA11CE);
        uint256 firstBuyAmount = 0.01 ether;
        uint256 creatorBefore = CREATOR.balance;
        (bytes32 predictedMarket,,,,) = factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        (bytes32 marketId, address token, uint256 tokensOut, uint256 refund) =
            router.launchAndBuy{value: LAUNCH_FEE + firstBuyAmount}(params, firstBuyAmount, 1, recipient);

        assertEq(marketId, predictedMarket);
        assertGt(tokensOut, 0);
        assertEq(refund, 0);
        assertEq(TickerMemeTokenV1(token).balanceOf(recipient), tokensOut);
        assertEq(CREATOR.balance, creatorBefore - LAUNCH_FEE - firstBuyAmount);
        assertEq(address(router).balance, 0);
        assertGt(marketRegistry.market(marketId).config.curve.code.length, 0);
    }

    function test_launchAndBuyNativeTailFillReturnsExactRefundToCreatorAndLeavesNoDust() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-TAIL"));
        address recipient = address(0xA11CE);
        uint256 firstBuyAmount = 100 ether;
        uint256 creatorBefore = CREATOR.balance;

        vm.prank(CREATOR);
        (bytes32 marketId, address token, uint256 tokensOut, uint256 refund) =
            router.launchAndBuy{value: LAUNCH_FEE + firstBuyAmount}(params, firstBuyAmount, 1, recipient);

        assertGt(tokensOut, 0);
        assertGt(refund, 0);
        assertLt(refund, firstBuyAmount);
        assertEq(TickerMemeTokenV1(token).balanceOf(recipient), tokensOut);
        assertEq(CREATOR.balance, creatorBefore - LAUNCH_FEE - (firstBuyAmount - refund));
        assertEq(address(router).balance, 0);
        assertEq(marketRegistry.market(marketId).runtime.launchPhase, 1);
        assertGt(feeVault.credited(), 0);
    }

    function test_launchAndBuyNativeRejectedRefundRollsBackTheWholeLaunch() public {
        _setValidConfiguration(address(0));
        FactoryRejectingCreator rejectingCreator = new FactoryRejectingCreator();
        address creator = address(rejectingCreator);
        vm.deal(creator, 200 ether);
        CreateMarketParams memory params = _validParams(creator, bytes32("ROUTER-REFUND-REJECT"));
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(creator, params);
        uint256 treasuryBefore = address(treasury).balance;

        vm.expectRevert();
        rejectingCreator.launch{value: LAUNCH_FEE + 100 ether}(router, params, 100 ether, creator);

        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 0);
        assertEq(address(treasury).balance, treasuryBefore);
        assertEq(address(router).balance, 0);
    }

    function test_launchAndBuyNativeRequiresExactCombinedValueBeforeDeployment() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-VALUE"));
        uint256 firstBuyAmount = 0.01 ether;
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchAndBuyRouterNative.InvalidLaunchAndBuyValue.selector,
                LAUNCH_FEE + firstBuyAmount,
                LAUNCH_FEE + firstBuyAmount - 1
            )
        );
        router.launchAndBuy{value: LAUNCH_FEE + firstBuyAmount - 1}(params, firstBuyAmount, 0, CREATOR);
        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchAndBuyRouterNative.InvalidLaunchAndBuyValue.selector,
                LAUNCH_FEE + firstBuyAmount,
                LAUNCH_FEE + firstBuyAmount + 1
            )
        );
        router.launchAndBuy{value: LAUNCH_FEE + firstBuyAmount + 1}(params, firstBuyAmount, 0, CREATOR);

        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 0);
    }

    function test_launchAndBuyNativeRejectsInvalidBuyAndRecipientBeforeDeployment() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-INPUT"));
        (, address token, address curve, address gauge,) = factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidFirstBuyAmount.selector, 0));
        router.launchAndBuy{value: LAUNCH_FEE}(params, 0, 0, CREATOR);
        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidFirstBuyRecipient.selector, address(0)));
        router.launchAndBuy{value: LAUNCH_FEE + 1}(params, 1, 0, address(0));
        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidFirstBuyRecipient.selector, address(router))
        );
        router.launchAndBuy{value: LAUNCH_FEE + 1}(params, 1, 0, address(router));

        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
    }

    function test_launchAndBuyNativeBuyFailureRollsBackMarketAndCanRetrySameIdentity() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ROLLBACK"));
        uint256 firstBuyAmount = 0.01 ether;
        (bytes32 predictedMarket, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert();
        router.launchAndBuy{value: LAUNCH_FEE + firstBuyAmount}(params, firstBuyAmount, type(uint256).max, CREATOR);
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
        assertEq(revenueRegistry.currentCreatorEpoch(predictedMarket), 0);

        vm.prank(CREATOR);
        (bytes32 retriedMarket,,,) =
            router.launchAndBuy{value: LAUNCH_FEE + firstBuyAmount}(params, firstBuyAmount, 0, CREATOR);
        assertEq(retriedMarket, predictedMarket);
    }

    function test_launchAndBuyNativePreservesForcedHistoricRouterBalance() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-FORCED"));
        uint256 forcedBalance = 3 ether;
        uint256 firstBuyAmount = 0.01 ether;
        vm.deal(address(router), forcedBalance);

        vm.prank(CREATOR);
        router.launchAndBuy{value: LAUNCH_FEE + firstBuyAmount}(params, firstBuyAmount, 0, CREATOR);

        assertEq(address(router).balance, forcedBalance);
    }

    function test_launchAndBuyERC20PullsExactQuoteAndBuysForRecipient() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20"));
        uint256 firstBuyAmount = 1_000_000;
        address recipient = address(0xA11CE);
        quote.mint(CREATOR, 2_000_000);
        vm.prank(CREATOR);
        quote.approve(address(router), firstBuyAmount);

        vm.prank(CREATOR);
        (bytes32 marketId, address token, uint256 tokensOut, uint256 refund) =
            router.launchAndBuy{value: LAUNCH_FEE}(params, firstBuyAmount, 1, recipient);

        address curve = marketRegistry.market(marketId).config.curve;
        assertGt(tokensOut, 0);
        assertEq(refund, 0);
        assertEq(TickerMemeTokenV1(token).balanceOf(recipient), tokensOut);
        assertEq(quote.balanceOf(CREATOR), 1_000_000);
        assertEq(quote.balanceOf(address(router)), 0);
        assertEq(quote.allowance(address(router), curve), 0);
        assertEq(address(router).balance, 0);
    }

    function test_launchAndBuyERC20TailFillReturnsExactTokenRefundToCreator() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-TAIL"));
        uint256 firstBuyAmount = 100_000_000;
        uint256 creatorBefore = 200_000_000;
        quote.mint(CREATOR, creatorBefore);
        vm.prank(CREATOR);
        quote.approve(address(router), firstBuyAmount);

        vm.prank(CREATOR);
        (bytes32 marketId, address token, uint256 tokensOut, uint256 refund) =
            router.launchAndBuy{value: LAUNCH_FEE}(params, firstBuyAmount, 1, CREATOR);

        address curve = marketRegistry.market(marketId).config.curve;
        assertGt(tokensOut, 0);
        assertGt(refund, 0);
        assertLt(refund, firstBuyAmount);
        assertEq(TickerMemeTokenV1(token).balanceOf(CREATOR), tokensOut);
        assertEq(quote.balanceOf(CREATOR), creatorBefore - (firstBuyAmount - refund));
        assertEq(quote.balanceOf(address(router)), 0);
        assertEq(quote.allowance(address(router), curve), 0);
        assertEq(marketRegistry.market(marketId).runtime.launchPhase, 1);
        assertGt(feeVault.credited(), 0);
    }

    function test_launchAndBuyERC20RequiresOnlyExactNativeLaunchFee() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-FEE"));
        (, address token, address curve, address gauge,) = factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidLaunchAndBuyValue.selector, LAUNCH_FEE, 0)
        );
        router.launchAndBuy(params, 1, 0, CREATOR);
        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchAndBuyRouterNative.InvalidLaunchAndBuyValue.selector, LAUNCH_FEE, LAUNCH_FEE + 1
            )
        );
        router.launchAndBuy{value: LAUNCH_FEE + 1}(params, 1, 0, CREATOR);

        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
    }

    function test_launchAndBuyERC20MissingAllowanceFailsBeforeMarketCreation() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-ALLOWANCE"));
        quote.mint(CREATOR, 1_000_000);
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterERC20.QuoteTransferCallFailed.selector, address(quote))
        );
        router.launchAndBuy{value: LAUNCH_FEE}(params, 1_000_000, 0, CREATOR);

        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 0);
    }

    function test_launchAndBuyERC20RejectsFeeOnTransferBeforeMarketCreation() public {
        MockFeeOnTransferQuoteToken taxedQuote = new MockFeeOnTransferQuoteToken(6, 100);
        _setValidConfiguration(address(taxedQuote));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-TAX"));
        taxedQuote.mint(CREATOR, 1_000_000);
        vm.prank(CREATOR);
        taxedQuote.approve(address(router), 1_000_000);
        (, address token, address curve, address gauge,) = factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchAndBuyRouterERC20.InexactQuoteBalanceDelta.selector, address(taxedQuote), 1_000_000, 990_000
            )
        );
        router.launchAndBuy{value: LAUNCH_FEE}(params, 1_000_000, 0, CREATOR);

        assertEq(taxedQuote.balanceOf(CREATOR), 1_000_000);
        assertEq(taxedQuote.balanceOf(address(router)), 0);
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
    }

    function test_launchAndBuyERC20RejectsNonCanonicalTransferReturns() public {
        MockReturnAnomalyQuoteToken anomalousQuote = new MockReturnAnomalyQuoteToken();
        _setValidConfiguration(address(anomalousQuote));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-RETURN"));
        (, address token, address curve, address gauge,) = factory.predictMarketAddresses(CREATOR, params);

        for (uint256 mode; mode < 3; ++mode) {
            anomalousQuote.setMode(MockReturnAnomalyQuoteToken.ReturnMode(mode));
            vm.prank(CREATOR);
            vm.expectRevert(
                abi.encodeWithSelector(
                    LaunchAndBuyRouterERC20.InvalidQuoteTransferReturn.selector, address(anomalousQuote)
                )
            );
            router.launchAndBuy{value: LAUNCH_FEE}(params, 1, 0, CREATOR);
        }

        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
    }

    function test_launchAndBuyERC20TransferCallbackCannotEnterRouter() public {
        MockCallbackQuoteToken callbackQuote = new MockCallbackQuoteToken(6);
        _setValidConfiguration(address(callbackQuote));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-CALLBACK"));
        callbackQuote.mint(CREATOR, 1_000_000);
        vm.prank(CREATOR);
        callbackQuote.approve(address(router), 1_000_000);
        callbackQuote.setCallbackEnabled(true);
        (, address token, address curve, address gauge,) = factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterERC20.QuoteTransferCallFailed.selector, address(callbackQuote))
        );
        router.launchAndBuy{value: LAUNCH_FEE}(params, 1_000_000, 0, CREATOR);

        assertEq(callbackQuote.balanceOf(CREATOR), 1_000_000);
        assertEq(callbackQuote.balanceOf(address(router)), 0);
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
    }

    function test_launchAndBuyERC20ReentrantTransferCannotEnterCanonicalMutation() public {
        FactoryReentrantQuoteToken reentrantQuote = new FactoryReentrantQuoteToken(router);
        _setValidConfiguration(address(reentrantQuote));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-REENTRANT"));
        reentrantQuote.mint(CREATOR, 1_000_000);
        vm.prank(CREATOR);
        reentrantQuote.approve(address(router), 1_000_000);
        reentrantQuote.setAttack(true);
        (, address token, address curve, address gauge,) = factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterERC20.QuoteTransferCallFailed.selector, address(reentrantQuote))
        );
        router.launchAndBuy{value: LAUNCH_FEE}(params, 1_000_000, 0, CREATOR);

        assertEq(reentrantQuote.balanceOf(CREATOR), 1_000_000);
        assertEq(reentrantQuote.balanceOf(address(router)), 0);
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
    }

    function test_launchAndBuyERC20CurveApprovalFailureRollsBackCreatorPull() public {
        FactoryToggleApproveQuoteToken badQuote = new FactoryToggleApproveQuoteToken();
        _setValidConfiguration(address(badQuote));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-APPROVE"));
        badQuote.mint(CREATOR, 1_000_000);
        vm.prank(CREATOR);
        badQuote.approve(address(router), 1_000_000);
        badQuote.setFailApprove(true);
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterERC20.InvalidQuoteTransferReturn.selector, address(badQuote))
        );
        router.launchAndBuy{value: LAUNCH_FEE}(params, 1_000_000, 0, CREATOR);

        assertEq(badQuote.balanceOf(CREATOR), 1_000_000);
        assertEq(badQuote.balanceOf(address(router)), 0);
        assertEq(badQuote.allowance(CREATOR, address(router)), 1_000_000);
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 0);
    }

    function test_launchAndBuyERC20RejectedTokenRefundRollsBackTheWholeLaunch() public {
        FactoryToggleApproveQuoteToken rejectingQuote = new FactoryToggleApproveQuoteToken();
        _setValidConfiguration(address(rejectingQuote));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-REFUND"));
        uint256 firstBuyAmount = 100_000_000;
        rejectingQuote.mint(CREATOR, firstBuyAmount);
        vm.prank(CREATOR);
        rejectingQuote.approve(address(router), firstBuyAmount);
        rejectingQuote.setRejectedTransferRecipient(CREATOR);
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);
        uint256 treasuryBefore = address(treasury).balance;

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterERC20.InvalidQuoteTransferReturn.selector, address(rejectingQuote))
        );
        router.launchAndBuy{value: LAUNCH_FEE}(params, firstBuyAmount, 0, CREATOR);

        assertEq(rejectingQuote.balanceOf(CREATOR), firstBuyAmount);
        assertEq(rejectingQuote.balanceOf(address(router)), 0);
        assertEq(rejectingQuote.allowance(CREATOR, address(router)), firstBuyAmount);
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 0);
        assertEq(address(treasury).balance, treasuryBefore);
    }

    function test_launchAndBuyERC20BuyFailureRollsBackPullMarketAndCanRetry() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-ROLLBACK"));
        uint256 firstBuyAmount = 1_000_000;
        quote.mint(CREATOR, firstBuyAmount);
        vm.prank(CREATOR);
        quote.approve(address(router), firstBuyAmount);
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert();
        router.launchAndBuy{value: LAUNCH_FEE}(params, firstBuyAmount, type(uint256).max, CREATOR);
        assertEq(quote.balanceOf(CREATOR), firstBuyAmount);
        assertEq(quote.balanceOf(address(router)), 0);
        assertEq(quote.allowance(CREATOR, address(router)), firstBuyAmount);
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 0);

        vm.prank(CREATOR);
        (bytes32 retriedMarket,,,) = router.launchAndBuy{value: LAUNCH_FEE}(params, firstBuyAmount, 0, CREATOR);
        assertEq(retriedMarket, marketId);
        assertEq(quote.balanceOf(CREATOR), 0);
    }

    function test_launchAndBuyERC20PreservesForcedHistoricQuoteBalance() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-FORCED"));
        uint256 historicBalance = 777;
        uint256 firstBuyAmount = 1_000_000;
        quote.mint(address(router), historicBalance);
        quote.mint(CREATOR, firstBuyAmount);
        vm.prank(CREATOR);
        quote.approve(address(router), firstBuyAmount);

        vm.prank(CREATOR);
        router.launchAndBuy{value: LAUNCH_FEE}(params, firstBuyAmount, 0, CREATOR);

        assertEq(quote.balanceOf(address(router)), historicBalance);
    }

    function test_launchAndBuyUsesImmediateContractCallerAndNeverTxOriginAsCreator() public {
        _setValidConfiguration(address(0));
        FactoryRouterCaller caller = new FactoryRouterCaller();
        address origin = address(0x0B0B);
        CreateMarketParams memory params = _validParams(address(caller), bytes32("ROUTER-CALLER"));
        (bytes32 predictedMarket, address predictedToken,,,) = factory.predictMarketAddresses(address(caller), params);
        (bytes32 originMarket,,,,) = factory.predictMarketAddresses(origin, params);
        vm.deal(CREATOR, 1 ether);

        vm.prank(CREATOR, origin);
        (bytes32 marketId, address token,,) =
            caller.launch{value: LAUNCH_FEE + 0.01 ether}(router, params, 0.01 ether, 0, CREATOR);

        assertEq(marketId, predictedMarket);
        assertEq(token, predictedToken);
        assertNotEq(marketId, originMarket);
        assertEq(TickerMemeTokenV1(token).creator(), address(caller));
        assertEq(marketRegistry.market(marketId).config.creatorRevenueBeneficiaryAtCreation, BENEFICIARY);
    }

    function test_beneficiaryIsTypedRevenueIdentityButNeverReplacesCreatorOrMemeRecipient() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory original = _validParams(CREATOR, bytes32("ROUTER-IDENTITY"));
        CreateMarketParams memory changedBeneficiary = _validParams(CREATOR, bytes32("ROUTER-IDENTITY"));
        changedBeneficiary.creatorRevenueBeneficiary = address(0xB0B);
        (bytes32 originalMarket,,,,) = factory.predictMarketAddresses(CREATOR, original);
        (bytes32 beneficiaryMarket,,,,) = factory.predictMarketAddresses(CREATOR, changedBeneficiary);
        address recipient = address(0xA11CE);

        assertNotEq(originalMarket, beneficiaryMarket);

        vm.prank(CREATOR);
        (bytes32 marketId, address token, uint256 tokensOut,) =
            router.launchAndBuy{value: LAUNCH_FEE + 0.01 ether}(changedBeneficiary, 0.01 ether, 0, recipient);
        assertEq(marketId, beneficiaryMarket);
        assertEq(TickerMemeTokenV1(token).creator(), CREATOR);
        assertEq(TickerMemeTokenV1(token).balanceOf(recipient), tokensOut);
        assertEq(marketRegistry.market(marketId).config.creatorRevenueBeneficiaryAtCreation, address(0xB0B));
    }

    function test_saltChangesMarketAndEveryCreate2ComponentNamespace() public {
        CreateMarketParams memory original = _validParams(CREATOR, bytes32("ROUTER-SALT"));
        CreateMarketParams memory changedSalt = _validParams(CREATOR, bytes32("ROUTER-SALT-2"));
        (bytes32 originalMarket, address originalToken, address originalCurve, address originalGauge,) =
            factory.predictMarketAddresses(CREATOR, original);
        (bytes32 saltMarket, address saltToken, address saltCurve, address saltGauge,) =
            factory.predictMarketAddresses(CREATOR, changedSalt);

        assertNotEq(originalMarket, saltMarket);
        assertNotEq(originalToken, saltToken);
        assertNotEq(originalCurve, saltCurve);
        assertNotEq(originalGauge, saltGauge);
    }

    function test_authenticatedRouterExemptsOnlyTheAtomicFirstBuyRecipient() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ANTI-SNIPE"));
        address recipient = address(0xA11CE);
        uint256 firstBuyAmount = 0.01 ether;
        vm.recordLogs();

        vm.prank(CREATOR);
        (bytes32 marketId,,,) =
            router.launchAndBuy{value: LAUNCH_FEE + firstBuyAmount}(params, firstBuyAmount, 0, recipient);
        address curve = marketRegistry.market(marketId).config.curve;
        (bool foundFirst, uint256 firstTax) = _curveBuyTax(vm.getRecordedLogs(), curve, address(router), recipient);
        assertTrue(foundFirst);
        assertEq(firstTax, 0);

        vm.deal(address(router), firstBuyAmount);
        vm.recordLogs();
        vm.prank(address(router));
        PonsCompatibleCurve(payable(curve)).buy{value: firstBuyAmount}(firstBuyAmount, 0, recipient);
        (bool foundSecond, uint256 secondTax) = _curveBuyTax(vm.getRecordedLogs(), curve, address(router), recipient);
        assertTrue(foundSecond);
        assertGt(secondTax, 0);
    }

    function test_launchAndBuyRouterEmitsNoEventsOfItsOwn() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-NO-EVENTS"));
        vm.recordLogs();

        vm.prank(CREATOR);
        router.launchAndBuy{value: LAUNCH_FEE + 0.01 ether}(params, 0.01 ether, 0, CREATOR);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertNotEq(logs[i].emitter, address(router));
        }
    }

    function test_launchAndBuyRouterHasNoIdentityOverrideOrArbitraryExecutionSurface() public {
        bytes4[6] memory forbidden = [
            bytes4(
                keccak256(
                    "launchAndBuyFor(address,(bytes32,bytes32,bytes32,bytes32,bytes32,address,string,string,string,bytes32),uint256,uint256,address)"
                )
            ),
            bytes4(keccak256("permit(bytes)")),
            bytes4(keccak256("execute(address,bytes)")),
            bytes4(keccak256("multicall(bytes[])")),
            bytes4(keccak256("initialize()")),
            bytes4(keccak256("setFactory(address)"))
        ];
        for (uint256 i; i < forbidden.length; ++i) {
            (bool success,) = address(router).call(abi.encodePacked(forbidden[i]));
            assertFalse(success);
        }
    }

    function test_launchAndBuyRouterRejectsFactoryRegistryBindingDrift() public {
        FactoryConfigRegistryMock wrongRegistry = new FactoryConfigRegistryMock();
        LaunchAndBuyRouter wrongRouter = new LaunchAndBuyRouter(address(factory), address(wrongRegistry));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-BINDING"));

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchAndBuyRouterNative.LaunchFactoryRegistryMismatch.selector,
                address(wrongRegistry),
                address(configs)
            )
        );
        wrongRouter.launchAndBuy{value: LAUNCH_FEE}(params, 1, 0, CREATOR);
    }

    function test_launchAndBuyRouterConstructorRejectsInvalidDependencies() public {
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidLaunchRouterDependency.selector, address(0))
        );
        new LaunchAndBuyRouter(address(0), address(configs));
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidLaunchRouterDependency.selector, address(0))
        );
        new LaunchAndBuyRouter(address(factory), address(0));
        address noCode = address(0x123456);
        vm.expectRevert(abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidLaunchRouterDependency.selector, noCode));
        new LaunchAndBuyRouter(address(factory), noCode);
    }

    function test_factorySelectorsMatchCanonicalInterfaceAndNoInitializerExists() public {
        assertEq(TickerGardenFactoryV1.createMarket.selector, ITickerGardenFactoryV1.createMarket.selector);
        assertEq(TickerGardenFactoryV1.createMarketFor.selector, ITickerGardenFactoryV1.createMarketFor.selector);
        assertEq(
            TickerGardenFactoryV1.previewMarketEconomics.selector,
            ITickerGardenFactoryV1.previewMarketEconomics.selector
        );
        assertEq(
            TickerGardenFactoryV1.predictMarketAddresses.selector,
            ITickerGardenFactoryV1.predictMarketAddresses.selector
        );
        (bool initializer,) = address(factory).call(abi.encodeWithSignature("initialize()"));
        assertFalse(initializer);
        assertEq(LaunchAndBuyRouter.launchAndBuy.selector, ILaunchAndBuyRouter.launchAndBuy.selector);
    }

    function _factoryInit() private view returns (TickerGardenFactoryInit memory init) {
        init = TickerGardenFactoryInit({
            officialStockRegistry: address(configs),
            approvedQuoteRegistry: address(configs),
            ponsBaselineRegistry: address(configs),
            launchTemplateRegistry: address(configs),
            marketRegistry: address(marketRegistry),
            creatorRevenueRegistry: address(revenueRegistry),
            protocolFeeVault: address(feeVault),
            allocationManager: address(allocationManager),
            launchRouter: address(router),
            platformTreasury: address(treasury),
            treasuryDistributor: address(treasury),
            memeTokenImplementation: address(tokenImplementation),
            curveImplementation: address(curveImplementation),
            gaugeImplementation: address(gaugeImplementation),
            feePolicyId: FEE_POLICY_ID
        });
    }

    function _setValidConfiguration(address quoteAsset) private {
        configs.setAsset(
            ASSET_UID,
            AssetView({stockToken: address(stock), userStockVault: address(stockVault), tokenDecimals: 18, status: 1})
        );
        configs.setQuote(
            QUOTE_ID,
            QuoteAssetConfig({
                ponsBaselineId: BASELINE_ID,
                quoteAsset: quoteAsset,
                quoteDecimals: quoteAsset == address(0) ? 18 : 6,
                phantomQuote: quoteAsset == address(0) ? 0.3 ether : 30_000_000,
                graduationThreshold: quoteAsset == address(0) ? 0.09 ether : 9_000_000,
                economicsHash: QUOTE_ID,
                status: 1
            })
        );
        configs.setBaseline(
            BASELINE_ID,
            PonsBaseline({
                referenceChainId: 3027,
                referenceFactory: address(0x1234),
                referenceFactoryCodeHash: keccak256("reference-factory"),
                launchConfigId: 1,
                supply: SUPPLY,
                curveFeeBps: 100,
                poolFee: 0,
                tickSpacing: 60,
                behaviorVectorRoot: keccak256("behavior"),
                status: 1
            })
        );
        configs.setTemplate(
            TEMPLATE_ID,
            LaunchTemplate({
                memeTokenImplementation: address(tokenImplementation),
                memeTokenCodeHash: address(tokenImplementation).codehash,
                curveImplementation: address(curveImplementation),
                curveCodeHash: address(curveImplementation).codehash,
                gaugeImplementation: address(gaugeImplementation),
                gaugeCodeHash: address(gaugeImplementation).codehash,
                graduatedHook: hook,
                hookCodeHash: hook.codehash,
                graduationExecutor: address(graduation),
                launchLockerImplementation: address(lockerImplementation),
                launchLockerCodeHash: address(lockerImplementation).codehash,
                feePolicyId: FEE_POLICY_ID,
                executionSpecId: EXECUTION_SPEC_ID,
                status: 1
            }),
            TEMPLATE_HASH
        );
    }

    function _validParams(address creator, bytes32 salt) private returns (CreateMarketParams memory params) {
        params = CreateMarketParams({
            assetUid: ASSET_UID,
            ponsBaselineId: BASELINE_ID,
            quoteAssetConfigId: QUOTE_ID,
            launchTemplateId: TEMPLATE_ID,
            expectedEconomics: bytes32(0),
            creatorRevenueBeneficiary: BENEFICIARY,
            name: "Ticker Garden",
            symbol: "GARDEN",
            metadataURI: "ipfs://ticker-garden",
            salt: salt
        });
        vm.prank(creator);
        params.expectedEconomics = factory.previewMarketEconomics(params);
    }

    function _expectFactoryCreateRevert(CreateMarketParams memory params, bytes memory revertData) private {
        vm.prank(CREATOR);
        vm.expectRevert(revertData);
        factory.createMarket{value: LAUNCH_FEE}(params);
    }

    function _assertComponentDeploymentFailureRollsBack(bytes32 salt, uint8 failedComponent) private {
        CreateMarketParams memory params = _validParams(CREATOR, salt);
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);
        address collision = failedComponent == 0 ? token : failedComponent == 1 ? curve : gauge;
        uint256 treasuryBefore = address(treasury).balance;
        vm.etch(collision, hex"00");

        vm.prank(CREATOR);
        if (failedComponent == 2) {
            vm.expectRevert(Errors.FailedDeployment.selector);
        } else {
            vm.expectPartialRevert(TickerGardenFactoryV1.ComponentDeploymentCallFailed.selector);
        }
        factory.createMarket{value: LAUNCH_FEE}(params);
        vm.etch(collision, bytes(""));

        _assertLaunchRolledBack(marketId, token, curve, gauge, treasuryBefore);
        vm.prank(CREATOR);
        (bytes32 retryId,,,) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(retryId, marketId);
    }

    function _assertLaunchRolledBack(
        bytes32 marketId,
        address token,
        address curve,
        address gauge,
        uint256 treasuryBefore
    ) private {
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
        assertEq(address(treasury).balance, treasuryBefore);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 0);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV1.MarketNotRegistered.selector, marketId));
        marketRegistry.market(marketId);
    }

    function _curveBuyTax(Vm.Log[] memory logs, address curve, address buyer, address recipient)
        private
        pure
        returns (bool found, uint256 tax)
    {
        bytes32 signature = keccak256("CurveBuy(address,address,uint256,uint256,uint256,uint256)");
        bytes32 buyerTopic = bytes32(uint256(uint160(buyer)));
        bytes32 recipientTopic = bytes32(uint256(uint160(recipient)));
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != curve || logs[i].topics.length != 3 || logs[i].topics[0] != signature
                    || logs[i].topics[1] != buyerTopic || logs[i].topics[2] != recipientTopic
            ) continue;
            (,,, tax) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            return (true, tax);
        }
    }
}
