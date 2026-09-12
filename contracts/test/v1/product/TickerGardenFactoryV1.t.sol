// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Errors} from "@openzeppelin/contracts/utils/Errors.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface IFactoryUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

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
    MarketConfig,
    TickerGardenBaseline,
    PositionView,
    QuoteAssetConfig
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {CreatorRevenueRegistry} from "../../../src/v1/modules/CreatorRevenueRegistry.sol";
import {LaunchAndBuyRouter} from "../../../src/v1/modules/LaunchAndBuyRouter.sol";
import {MarketRegistryV1} from "../../../src/v1/modules/MarketRegistryV1.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {TickerGardenCurve} from "../../../src/v1/modules/TickerGardenCurve.sol";
import {TickerMemeTokenV1} from "../../../src/v1/modules/TickerMemeTokenV1.sol";
import {
    TickerGardenCurveImplementation,
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
    mapping(bytes32 => TickerGardenBaseline) private _baselines;
    mapping(bytes32 => LaunchTemplate) private _templates;
    mapping(bytes32 => bytes32) private _templateHashes;
    mapping(address => bytes32) private _vaultSchemaIds;
    mapping(bytes32 => address) private _vaultsBySchema;
    mapping(address => bytes32) private _vaultRuntimeCodeHashes;
    mapping(address => bool) private _vaultIdentitiesCurrent;
    bool private _quoteIdentityIsCurrent = true;
    address private _authority = address(this);
    address private _officialStockRegistry;

    function authority() external view returns (address) {
        return _authority;
    }

    function setAuthority(address value) external {
        _authority = value;
    }

    function setOfficialStockRegistry(address value) external {
        _officialStockRegistry = value;
    }

    function officialStockRegistry() external view returns (address) {
        return _officialStockRegistry;
    }

    function setAsset(bytes32 id, AssetView memory value) external {
        _assets[id] = value;
    }

    function setQuote(bytes32 id, QuoteAssetConfig memory value) external {
        _quotes[id] = value;
    }

    function setQuoteIdentityCurrent(bool current) external {
        _quoteIdentityIsCurrent = current;
    }

    function setBaseline(bytes32 id, TickerGardenBaseline memory value) external {
        _baselines[id] = value;
    }

    function setTemplate(bytes32 id, LaunchTemplate memory value, bytes32 contentHash) external {
        _templates[id] = value;
        _templateHashes[id] = contentHash;
    }

    function setVaultSchema(address vault, bytes32 schemaId) external {
        _vaultSchemaIds[vault] = schemaId;
        _vaultsBySchema[schemaId] = vault;
        _vaultRuntimeCodeHashes[vault] = vault.codehash;
        _vaultIdentitiesCurrent[vault] = true;
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

    function vaultRuntimeCodeHash(address vault) external view returns (bytes32) {
        return _vaultRuntimeCodeHashes[vault];
    }

    function vaultIdentityCurrent(address vault) external view returns (bool) {
        return _vaultIdentitiesCurrent[vault];
    }

    function quoteConfig(bytes32 id) external view returns (QuoteAssetConfig memory) {
        return _quotes[id];
    }

    function quoteIdentityCurrent(bytes32) external view returns (bool) {
        return _quoteIdentityIsCurrent;
    }

    function baseline(bytes32 id) external view returns (TickerGardenBaseline memory) {
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
    address private _officialStockRegistry;
    address private _marketRegistry;

    function setFactoryBindings(address officialStockRegistry_, address marketRegistry_) external {
        _officialStockRegistry = officialStockRegistry_;
        _marketRegistry = marketRegistry_;
    }

    function officialStockRegistry() external view returns (address) {
        return _officialStockRegistry;
    }

    function marketRegistry() external view returns (address) {
        return _marketRegistry;
    }

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

    function rageQuitRewardCutoff(bytes32, address) external pure returns (uint256, uint256, uint256) {
        return (0, 0, 0);
    }
}

contract FactoryCurveFeeVaultMock {
    address public authority;

    function setAuthority(address value) external {
        authority = value;
    }
    uint256 public credited;
    address public marketRegistry;
    address public poolManager;
    address public creatorRevenueRegistry;
    address public platformTreasury;
    bytes32 public feePolicyId;

    function setBindings(
        address marketRegistry_,
        address poolManager_,
        address creatorRevenueRegistry_,
        address platformTreasury_,
        bytes32 feePolicyId_
    ) external {
        marketRegistry = marketRegistry_;
        poolManager = poolManager_;
        creatorRevenueRegistry = creatorRevenueRegistry_;
        platformTreasury = platformTreasury_;
        feePolicyId = feePolicyId_;
    }

    function beginCurveCredit(bytes32, address, uint256, uint256, uint32, uint64, bytes32) external {}

    function finalizeCurveCredit(bytes32, address quoteAsset, uint256 amount, uint256, uint32, uint64, bytes32)
        external
        payable
    {
        require(msg.value == (quoteAsset == address(0) ? amount : 0), "INVALID_SWEEP_VALUE");
        credited += amount;
    }
}

contract FactoryHookMock {
    address public marketRegistry;
    address public poolManager;
    address public protocolFeeVault;
    address public graduationExecutor;

    function setBindings(
        address marketRegistry_,
        address poolManager_,
        address protocolFeeVault_,
        address graduationExecutor_
    ) external {
        marketRegistry = marketRegistry_;
        poolManager = poolManager_;
        protocolFeeVault = protocolFeeVault_;
        graduationExecutor = graduationExecutor_;
    }
}

contract FactoryGraduationExecutorMock {
    IMarketRegistryV1 public marketRegistry;
    address public approvedQuoteRegistry;
    address public factory;
    address public poolManager;
    address public positionManager;
    address public permit2;
    address public hook;
    bytes32 public launchLockerCreationCodeHash = keccak256("locker");

    receive() external payable {}

    function setMarketRegistry(IMarketRegistryV1 value) external {
        require(address(marketRegistry) == address(0), "REGISTRY_ALREADY_SET");
        marketRegistry = value;
    }

    function setBindings(
        address approvedQuoteRegistry_,
        address factory_,
        address poolManager_,
        address positionManager_,
        address permit2_,
        address hook_
    ) external {
        approvedQuoteRegistry = approvedQuoteRegistry_;
        factory = factory_;
        poolManager = poolManager_;
        positionManager = positionManager_;
        permit2 = permit2_;
        hook = hook_;
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
    bool public rejectRegistration;
    uint256 public registrationCalls;
    bytes32 public registeredMarketId;
    address public registeredFeeVault;
    address public registeredLocker;
    address public marketRegistry;

    function setMarketRegistry(address value) external {
        marketRegistry = value;
    }

    function setReject(bool value) external {
        reject = value;
    }

    function setRejectRegistration(bool value) external {
        rejectRegistration = value;
    }

    function registerFeeSharingMarket(bytes32 marketId, address feeVault, address locker) external {
        require(!rejectRegistration, "TREASURY_REGISTRATION_REJECTED");
        registrationCalls += 1;
        registeredMarketId = marketId;
        registeredFeeVault = feeVault;
        registeredLocker = locker;
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

contract FactoryV4PoolManagerMock {
    address public quote;
    address private locker;
    mapping(bytes32 => bytes32) private transientValues;
    uint256 public nativeCost;

    function configure(address quote_, uint256 nativeCost_) external {
        quote = quote_;
        nativeCost = nativeCost_;
    }

    function unlock(bytes calldata data) external returns (bytes memory result) {
        locker = msg.sender;
        result = IFactoryUnlockCallback(msg.sender).unlockCallback(data);
        require(_delta(msg.sender, address(0)) == 0 && _delta(msg.sender, quote) == 0, "OPEN_DELTA");
        locker = address(0);
    }

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata) external returns (BalanceDelta) {
        require(
            msg.sender == locker && Currency.unwrap(key.currency0) == address(0)
                && Currency.unwrap(key.currency1) == quote,
            "BAD_POOL"
        );
        uint256 output = uint256(params.amountSpecified);
        require(
            output <= uint256(uint128(type(int128).max)) && nativeCost <= uint256(uint128(type(int128).max)), "RANGE"
        );
        _setDelta(msg.sender, address(0), -int256(nativeCost));
        _setDelta(msg.sender, quote, int256(output));
        return toBalanceDelta(-int128(int256(nativeCost)), int128(int256(output)));
    }
    function sync(Currency) external {}

    function settle() external payable returns (uint256 paid) {
        require(msg.sender == locker && msg.value == uint256(-_delta(msg.sender, address(0))), "BAD_SETTLE");
        _setDelta(msg.sender, address(0), 0);
        return msg.value;
    }

    function take(Currency currency, address to, uint256 amount) external {
        address token = Currency.unwrap(currency);
        require(msg.sender == locker && _delta(msg.sender, token) == int256(amount), "BAD_TAKE");
        _setDelta(msg.sender, token, 0);
        require(FactoryToggleApproveQuoteToken(token).transfer(to, amount), "TRANSFER");
    }

    function exttload(bytes32 slot) external view returns (bytes32) {
        return transientValues[slot];
    }

    function exttload(bytes32[] calldata slots) external view returns (bytes32[] memory values) {
        values = new bytes32[](slots.length);
        for (uint256 i; i < slots.length; ++i) {
            values[i] = transientValues[slots[i]];
        }
    }

    function _setDelta(address target, address token, int256 value) private {
        transientValues[keccak256(abi.encode(target, token))] = bytes32(uint256(value));
    }

    function _delta(address target, address token) private view returns (int256) {
        return int256(uint256(transientValues[keccak256(abi.encode(target, token))]));
    }
    receive() external payable {}
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
    bytes32 internal constant SECOND_QUOTE_ID = keccak256("factory-second-quote");
    bytes32 internal constant TEMPLATE_ID = keccak256("factory-template");
    bytes32 internal constant TEMPLATE_HASH = keccak256("factory-template-content");
    bytes32 internal constant FEE_POLICY_ID = keccak256("factory-fee-policy");
    bytes32 internal constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-11");
    bytes32 internal constant VAULT_SCHEMA_ID = keccak256("TickerGarden.UserStockVault.MultiAsset.v6");
    uint256 internal constant LAUNCH_FEE = 500_000_000_000_000;
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    address internal constant CREATOR = address(0xCAFE);
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant CANONICAL_HOOK = address(0x1000000000000000000000000000000000002044);

    FactoryConfigRegistryMock internal configs;
    FactoryConfigRegistryMock internal quoteConfigs;
    FactoryConfigRegistryMock internal baselineConfigs;
    FactoryConfigRegistryMock internal templateConfigs;
    FactoryDependencyMock internal accessManager;
    FactoryDependencyMock internal stockVault;
    FactoryCurveFeeVaultMock internal feeVault;
    FactoryDependencyMock internal allocationManager;
    FactoryDependencyMock internal lockerImplementation;
    FactoryV4PoolManagerMock internal fallbackPoolManager;
    FactoryGraduationExecutorMock internal graduation;
    FactoryTreasuryMock internal treasury;
    LaunchAndBuyRouter internal router;
    TickerMemeTokenV1Implementation internal tokenImplementation;
    TickerGardenCurveImplementation internal curveImplementation;
    MemeStockGauge internal gaugeImplementation;
    MockExactQuoteToken internal stock;
    MockExactQuoteToken internal quote;
    MarketRegistryV1 internal marketRegistry;
    CreatorRevenueRegistry internal revenueRegistry;
    TickerGardenFactoryV1 internal factory;
    FactoryHookMock internal hook;

    function setUp() public {
        configs = new FactoryConfigRegistryMock();
        quoteConfigs = new FactoryConfigRegistryMock();
        baselineConfigs = new FactoryConfigRegistryMock();
        templateConfigs = new FactoryConfigRegistryMock();
        accessManager = new FactoryDependencyMock();
        configs.setAuthority(address(accessManager));
        quoteConfigs.setAuthority(address(accessManager));
        quoteConfigs.setOfficialStockRegistry(address(configs));
        baselineConfigs.setAuthority(address(accessManager));
        templateConfigs.setAuthority(address(accessManager));
        stockVault = new FactoryDependencyMock();
        feeVault = new FactoryCurveFeeVaultMock();
        feeVault.setAuthority(address(accessManager));
        allocationManager = new FactoryDependencyMock();
        lockerImplementation = new FactoryDependencyMock();
        graduation = new FactoryGraduationExecutorMock();
        treasury = new FactoryTreasuryMock();
        FactoryHookMock hookImplementation = new FactoryHookMock();
        vm.etch(CANONICAL_HOOK, address(hookImplementation).code);
        hook = FactoryHookMock(CANONICAL_HOOK);
        FactoryAddressDeployer deployer = new FactoryAddressDeployer();
        address predictedFactory = vm.computeCreateAddress(address(deployer), 1);
        fallbackPoolManager = new FactoryV4PoolManagerMock();
        router =
            new LaunchAndBuyRouter(predictedFactory, address(quoteConfigs), address(fallbackPoolManager), 10_000, 200);
        tokenImplementation = new TickerMemeTokenV1Implementation();
        curveImplementation = new TickerGardenCurveImplementation();
        gaugeImplementation = new MemeStockGauge();
        stock = new MockExactQuoteToken(18);
        quote = new MockExactQuoteToken(6);
        fallbackPoolManager.configure(address(quote), 0.002 ether);
        quote.mint(address(fallbackPoolManager), 1_000_000_000_000);
        marketRegistry = new MarketRegistryV1(
            predictedFactory,
            address(configs),
            address(quoteConfigs),
            address(baselineConfigs),
            address(templateConfigs),
            address(graduation),
            address(stockVault),
            address(allocationManager)
        );
        graduation.setMarketRegistry(marketRegistry);
        revenueRegistry = new CreatorRevenueRegistry(predictedFactory, address(marketRegistry));
        allocationManager.setFactoryBindings(address(configs), address(marketRegistry));
        stockVault.setFactoryBindings(address(configs), address(marketRegistry));
        treasury.setMarketRegistry(address(marketRegistry));
        feeVault.setBindings(
            address(marketRegistry),
            address(lockerImplementation),
            address(revenueRegistry),
            address(treasury),
            FEE_POLICY_ID
        );
        hook.setBindings(address(marketRegistry), address(lockerImplementation), address(feeVault), address(graduation));
        graduation.setBindings(
            address(quoteConfigs),
            predictedFactory,
            address(lockerImplementation),
            address(lockerImplementation),
            address(lockerImplementation),
            address(hook)
        );
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
            address tickerGardenBaselineRegistry_,
            address launchTemplateRegistry_,
            address marketRegistry_,
            address protocolFeeVault_,
            address allocationManager_,
            address launchRouter_
        ) = factory.runtimeBindings();
        assertEq(factory.launchFee(), LAUNCH_FEE);
        assertEq(officialStockRegistry_, address(configs));
        assertEq(approvedQuoteRegistry_, address(quoteConfigs));
        assertEq(tickerGardenBaselineRegistry_, address(baselineConfigs));
        assertEq(launchTemplateRegistry_, address(templateConfigs));
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
        assertEq(factory.holderRewardsDistributor(), address(treasury));
    }

    function test_eachConfigRegistryMustShareOneCodeBearingAccessManager() public {
        FactoryConfigRegistryMock[4] memory registries = [configs, quoteConfigs, baselineConfigs, templateConfigs];
        address mismatchedAuthority = address(new FactoryDependencyMock());

        for (uint256 i; i < registries.length; ++i) {
            registries[i].setAuthority(mismatchedAuthority);
            _expectConstructorBindingFailure();
            registries[i].setAuthority(address(accessManager));
        }

        feeVault.setAuthority(mismatchedAuthority);
        _expectConstructorBindingFailure();
        feeVault.setAuthority(address(accessManager));

        address noCodeAuthority = address(0xA11CE);
        for (uint256 i; i < registries.length; ++i) {
            registries[i].setAuthority(noCodeAuthority);
        }
        _expectConstructorBindingFailure();
        for (uint256 i; i < registries.length; ++i) {
            registries[i].setAuthority(address(accessManager));
        }
    }

    function test_constructorRejectsQuoteRegistryBoundToDifferentOfficialStockRegistry() public {
        // Keep all four registry authorities aligned; only the Quote Registry's
        // Stock Registry binding is intentionally inconsistent.
        address wrongStockRegistry = address(new FactoryConfigRegistryMock());
        quoteConfigs.setOfficialStockRegistry(wrongStockRegistry);

        _expectConstructorBindingFailure();
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
        assertEq(value.config.tickerGardenBaselineId, BASELINE_ID);
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
        assertEq(value.config.graduatedHook, address(hook));
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
        assertEq(vm.parseJsonString(manifest, ".modules[13].module"), "TickerGardenCurve");
        assertEq(vm.parseJsonString(manifest, ".modules[16].module"), "TickerMemeTokenV1");
        assertEq(
            keccak256(type(MemeStockGauge).runtimeCode),
            vm.parseJsonBytes32(manifest, ".modules[9].runtimeTemplate.keccak256")
        );
        assertEq(
            keccak256(type(TickerGardenCurve).creationCode),
            vm.parseJsonBytes32(manifest, ".modules[13].creationCode.keccak256")
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
            V1Create2.initCodeHash(type(TickerGardenCurve).creationCode, abi.encode(address(factory)));
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
                    holderRewardsDistributor: address(treasury),
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
        assertEq(TickerGardenCurve(payable(curveAddress)).quoteAsset(), address(quote));

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
                holderRewardsDistributor: address(treasury),
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

    function test_launchFeeFollowsCanonicalFeeVaultTreasury() public {
        FactoryTreasuryMock nextTreasury = new FactoryTreasuryMock();
        feeVault.setBindings(
            address(marketRegistry),
            feeVault.poolManager(),
            address(revenueRegistry),
            address(nextTreasury),
            feeVault.feePolicyId()
        );
        assertEq(factory.platformTreasury(), address(nextTreasury));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROTATED-TREASURY"));
        uint256 beforeOld = address(treasury).balance;
        vm.prank(CREATOR);
        factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(address(nextTreasury).balance, LAUNCH_FEE);
        assertEq(address(treasury).balance, beforeOld);
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

        QuoteAssetConfig memory quoteConfig = quoteConfigs.quoteConfig(QUOTE_ID);
        quoteConfig.status = 2;
        quoteConfigs.setQuote(QUOTE_ID, quoteConfig);
        _expectFactoryCreateRevert(
            params, abi.encodeWithSelector(V1FactoryValidation.InactiveQuote.selector, QUOTE_ID, uint8(2))
        );
        _setValidConfiguration(address(quote));

        quoteConfig = quoteConfigs.quoteConfig(QUOTE_ID);
        quoteConfig.economicsHash = bytes32("WRONG-QUOTE-HASH");
        quoteConfigs.setQuote(QUOTE_ID, quoteConfig);
        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(
                V1FactoryValidation.InvalidQuoteEconomics.selector, QUOTE_ID, quoteConfig.economicsHash
            )
        );
        _setValidConfiguration(address(quote));

        quoteConfig = quoteConfigs.quoteConfig(QUOTE_ID);
        quoteConfig.tickerGardenBaselineId = bytes32("OTHER-BASELINE");
        quoteConfigs.setQuote(QUOTE_ID, quoteConfig);
        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(
                V1FactoryValidation.QuoteBaselineMismatch.selector, quoteConfig.tickerGardenBaselineId, BASELINE_ID
            )
        );
        _setValidConfiguration(address(quote));

        TickerGardenBaseline memory baseline = baselineConfigs.baseline(BASELINE_ID);
        baseline.status = 2;
        baselineConfigs.setBaseline(BASELINE_ID, baseline);
        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(V1FactoryValidation.InactiveTickerGardenBaseline.selector, BASELINE_ID, uint8(2))
        );
        _setValidConfiguration(address(quote));

        LaunchTemplate memory template = templateConfigs.launchTemplate(TEMPLATE_ID);
        template.status = 2;
        templateConfigs.setTemplate(TEMPLATE_ID, template, TEMPLATE_HASH);
        _expectFactoryCreateRevert(
            params, abi.encodeWithSelector(V1FactoryValidation.InactiveLaunchTemplate.selector, TEMPLATE_ID, uint8(2))
        );
        _setValidConfiguration(address(quote));

        template = templateConfigs.launchTemplate(TEMPLATE_ID);
        template.feePolicyId = bytes32("WRONG-FEE-POLICY");
        templateConfigs.setTemplate(TEMPLATE_ID, template, TEMPLATE_HASH);
        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(
                V1FactoryValidation.InvalidLaunchTemplateBinding.selector,
                template.feePolicyId,
                template.executionSpecId
            )
        );
        _setValidConfiguration(address(quote));

        template = templateConfigs.launchTemplate(TEMPLATE_ID);
        template.executionSpecId = bytes32("WRONG-EXECUTION-SPEC");
        templateConfigs.setTemplate(TEMPLATE_ID, template, TEMPLATE_HASH);
        _expectFactoryCreateRevert(
            params,
            abi.encodeWithSelector(
                V1FactoryValidation.InvalidLaunchTemplateBinding.selector,
                template.feePolicyId,
                template.executionSpecId
            )
        );
        _setValidConfiguration(address(quote));

        template = templateConfigs.launchTemplate(TEMPLATE_ID);
        templateConfigs.setTemplate(TEMPLATE_ID, template, bytes32(0));
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
        missingBaselineParams.tickerGardenBaselineId = missingBaseline;
        QuoteAssetConfig memory quoteConfig = quoteConfigs.quoteConfig(QUOTE_ID);
        quoteConfig.tickerGardenBaselineId = missingBaseline;
        quoteConfigs.setQuote(QUOTE_ID, quoteConfig);
        _expectFactoryCreateRevert(
            missingBaselineParams,
            abi.encodeWithSelector(V1FactoryValidation.InactiveTickerGardenBaseline.selector, missingBaseline, uint8(0))
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
        LaunchTemplate memory template = templateConfigs.launchTemplate(TEMPLATE_ID);
        template.gaugeImplementation = address(lockerImplementation);
        templateConfigs.setTemplate(TEMPLATE_ID, template, TEMPLATE_HASH);
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
        assertEq(TickerGardenCurve(payable(curve)).quoteAsset(), address(0));
        MemeStockGauge(gauge).rewardState(address(0));
    }

    function test_newMarketsMaySelectDifferentIndependentActiveQuoteConfigs() public {
        MockExactQuoteToken secondQuote = new MockExactQuoteToken(18);
        quoteConfigs.setQuote(
            SECOND_QUOTE_ID,
            QuoteAssetConfig({
                tickerGardenBaselineId: BASELINE_ID,
                quoteAsset: address(secondQuote),
                quoteDecimals: 18,
                phantomQuote: 0.3 ether,
                graduationThreshold: 0.09 ether,
                economicsHash: SECOND_QUOTE_ID,
                status: 1
            })
        );

        CreateMarketParams memory first = _validParams(CREATOR, bytes32("QUOTE-ONE"));
        vm.prank(CREATOR);
        (bytes32 firstMarket,,,) = factory.createMarket{value: LAUNCH_FEE}(first);

        CreateMarketParams memory second = _validParams(CREATOR, bytes32("QUOTE-TWO"));
        second.quoteAssetConfigId = SECOND_QUOTE_ID;
        vm.prank(CREATOR);
        second.expectedEconomics = factory.previewMarketEconomics(second);
        vm.prank(CREATOR);
        (bytes32 secondMarket,,,) = factory.createMarket{value: LAUNCH_FEE}(second);

        assertEq(marketRegistry.market(firstMarket).config.quoteAsset, address(quote));
        assertEq(marketRegistry.market(secondMarket).config.quoteAsset, address(secondQuote));
        assertNotEq(firstMarket, secondMarket);
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

    function test_launchAndBuyERC20WithZeroQuoteAutomaticallyUsesNativeExactOutput() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-NATIVE-FALLBACK"));
        uint256 firstBuyAmount = 1_000_000;
        uint256 maxNativeInput = 0.003 ether;
        uint256 creatorBefore = CREATOR.balance;
        assertEq(quote.balanceOf(CREATOR), 0);
        assertEq(quote.allowance(CREATOR, address(router)), 0);

        vm.prank(CREATOR);
        (bytes32 marketId, address token, uint256 tokensOut, uint256 nativeRefund) =
            router.launchAndBuy{value: LAUNCH_FEE + maxNativeInput}(params, firstBuyAmount, 1, CREATOR);

        assertGt(tokensOut, 0);
        assertEq(TickerMemeTokenV1(token).balanceOf(CREATOR), tokensOut);
        assertEq(nativeRefund, 0.001 ether);
        assertEq(CREATOR.balance, creatorBefore - LAUNCH_FEE - 0.002 ether);
        assertEq(address(router).balance, 0);
        assertEq(quote.balanceOf(address(router)), 0);
        assertEq(marketRegistry.market(marketId).config.quoteAsset, address(quote));
    }

    function test_launchAndBuyERC20NativeFallbackRollsBackWhenMaximumIsTooLow() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-NATIVE-LIMIT"));
        (, address token, address curve, address gauge,) = factory.predictMarketAddresses(CREATOR, params);
        vm.prank(CREATOR);
        vm.expectRevert();
        router.launchAndBuy{value: LAUNCH_FEE + 0.001 ether}(params, 1_000_000, 1, CREATOR);
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
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

    function test_launchAndBuyERC20DirectPathRequiresLaunchFee() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-ERC20-FEE"));
        (, address token, address curve, address gauge,) = factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidLaunchAndBuyValue.selector, LAUNCH_FEE, 0)
        );
        router.launchAndBuy(params, 1, 0, CREATOR);
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
        TickerGardenCurve(payable(curve)).buy{value: firstBuyAmount}(firstBuyAmount, 0, recipient);
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
        LaunchAndBuyRouter wrongRouter = new LaunchAndBuyRouter(
            address(factory), address(wrongRegistry), address(lockerImplementation), 10_000, 200
        );
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ROUTER-BINDING"));

        vm.prank(CREATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchAndBuyRouterNative.LaunchFactoryRegistryMismatch.selector,
                address(wrongRegistry),
                address(quoteConfigs)
            )
        );
        wrongRouter.launchAndBuy{value: LAUNCH_FEE}(params, 1, 0, CREATOR);
    }

    function test_launchAndBuyRouterConstructorRejectsInvalidDependencies() public {
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidLaunchRouterDependency.selector, address(0))
        );
        new LaunchAndBuyRouter(address(0), address(quoteConfigs), address(lockerImplementation), 10_000, 200);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidLaunchRouterDependency.selector, address(0))
        );
        new LaunchAndBuyRouter(address(factory), address(0), address(lockerImplementation), 10_000, 200);
        address noCode = address(0x123456);
        vm.expectRevert(abi.encodeWithSelector(LaunchAndBuyRouterNative.InvalidLaunchRouterDependency.selector, noCode));
        new LaunchAndBuyRouter(address(factory), noCode, address(lockerImplementation), 10_000, 200);
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
            approvedQuoteRegistry: address(quoteConfigs),
            tickerGardenBaselineRegistry: address(baselineConfigs),
            launchTemplateRegistry: address(templateConfigs),
            marketRegistry: address(marketRegistry),
            creatorRevenueRegistry: address(revenueRegistry),
            protocolFeeVault: address(feeVault),
            allocationManager: address(allocationManager),
            launchRouter: address(router),
            platformTreasury: address(treasury),
            holderRewardsDistributor: address(treasury),
            memeTokenImplementation: address(tokenImplementation),
            curveImplementation: address(curveImplementation),
            gaugeImplementation: address(gaugeImplementation),
            feePolicyId: FEE_POLICY_ID
        });
    }

    function _expectConstructorBindingFailure() private {
        FactoryAddressDeployer deployer = new FactoryAddressDeployer();
        address predictedFactory = vm.computeCreateAddress(address(deployer), 1);
        bytes memory factoryGetter = abi.encodeWithSignature("factory()");
        vm.mockCall(address(marketRegistry), factoryGetter, abi.encode(predictedFactory));
        vm.mockCall(address(revenueRegistry), factoryGetter, abi.encode(predictedFactory));
        vm.mockCall(address(graduation), factoryGetter, abi.encode(predictedFactory));
        vm.mockCall(address(router), factoryGetter, abi.encode(predictedFactory));

        vm.expectRevert(TickerGardenFactoryV1.InvalidFactoryBinding.selector);
        deployer.deploy(_factoryInit());
        vm.clearMockedCalls();
    }

    function _setValidConfiguration(address quoteAsset) private {
        configs.setAsset(
            ASSET_UID,
            AssetView({stockToken: address(stock), userStockVault: address(stockVault), tokenDecimals: 18, status: 1})
        );
        quoteConfigs.setQuote(
            QUOTE_ID,
            QuoteAssetConfig({
                tickerGardenBaselineId: BASELINE_ID,
                quoteAsset: quoteAsset,
                quoteDecimals: quoteAsset == address(0) ? 18 : 6,
                phantomQuote: quoteAsset == address(0) ? 0.3 ether : 30_000_000,
                graduationThreshold: quoteAsset == address(0) ? 0.09 ether : 9_000_000,
                economicsHash: QUOTE_ID,
                status: 1
            })
        );
        baselineConfigs.setBaseline(
            BASELINE_ID,
            TickerGardenBaseline({
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
        templateConfigs.setTemplate(
            TEMPLATE_ID,
            LaunchTemplate({
                memeTokenImplementation: address(tokenImplementation),
                memeTokenCodeHash: address(tokenImplementation).codehash,
                curveImplementation: address(curveImplementation),
                curveCodeHash: address(curveImplementation).codehash,
                gaugeImplementation: address(gaugeImplementation),
                gaugeCodeHash: address(gaugeImplementation).codehash,
                graduatedHook: address(hook),
                hookCodeHash: address(hook).codehash,
                graduationExecutor: address(graduation),
                graduationExecutorCodeHash: address(graduation).codehash,
                feePolicyId: FEE_POLICY_ID,
                executionSpecId: EXECUTION_SPEC_ID,
                status: 1
            }),
            TEMPLATE_HASH
        );
    }

    function test_creatorTaxCapAndEconomicsCommitment() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("TAX-CAP"));
        bytes32 untaxed = params.expectedEconomics;
        params.creatorTaxBps = 500;
        bytes32 taxed = factory.previewMarketEconomics(params);
        assertTrue(taxed != untaxed);
        params.expectedEconomics = taxed;
        vm.prank(CREATOR);
        (bytes32 marketId,, address curveAddress,) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(marketRegistry.market(marketId).config.creatorTaxBps, 500);
        assertEq(TickerGardenCurve(payable(curveAddress)).creatorTaxBps(), 500);
        params.creatorTaxBps = 501;
        vm.expectRevert(abi.encodeWithSignature("CreatorTaxTooHigh(uint256,uint256)", uint256(501), uint256(500)));
        factory.previewMarketEconomics(params);
    }

    function test_disabledStakingCreatesWithoutStockOrGaugeAndPreservesHolderChoice() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("NO-STAKING"));
        bytes32 enabledEconomics = params.expectedEconomics;
        params.stakingEnabled = false;
        params.assetUid = bytes32(0);
        params.creatorFeesToHolders = true;
        params.creatorTaxBps = 500;
        vm.mockCallRevert(
            address(configs), abi.encodeWithSignature("asset(bytes32)", bytes32(0)), bytes("NO_STOCK_LOOKUP")
        );
        params.expectedEconomics = factory.previewMarketEconomics(params);
        assertNotEq(params.expectedEconomics, enabledEconomics);
        (bytes32 expectedId, address predictedToken, address predictedCurve, address predictedGauge,) =
            factory.predictMarketAddresses(CREATOR, params);
        assertEq(predictedGauge, address(0));
        vm.prank(CREATOR);
        (bytes32 id, address token, address curve, address gauge) = factory.createMarket{value: LAUNCH_FEE}(params);
        assertEq(id, expectedId);
        assertEq(token, predictedToken);
        assertEq(curve, predictedCurve);
        assertEq(gauge, address(0));
        MarketConfig memory config = marketRegistry.market(id).config;
        assertFalse(config.stakingEnabled);
        assertEq(config.assetUid, bytes32(0));
        assertTrue(config.creatorFeesToHolders);
        assertEq(config.creatorTaxBps, 500);
        assertEq(treasury.registeredMarketId(), id);
    }

    function test_stakingModeRejectsContradictoryStockAndStaleEconomics() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("STAKING-MODE"));
        params.stakingEnabled = false;
        vm.expectRevert(abi.encodeWithSignature("InvalidStakingConfiguration()"));
        factory.previewMarketEconomics(params);
        params.assetUid = bytes32(0);
        vm.expectRevert();
        factory.predictMarketAddresses(CREATOR, params);
        params.stakingEnabled = true;
        vm.expectRevert(abi.encodeWithSignature("InvalidStakingConfiguration()"));
        factory.previewMarketEconomics(params);
    }

    function test_creatorFeesToHoldersChangesEconomicsAndPredictedIdentity() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("HOLDER-FEES"));
        bytes32 creatorOnlyEconomics = params.expectedEconomics;
        (bytes32 creatorOnlyMarket,,,,) = factory.predictMarketAddresses(CREATOR, params);

        params.creatorFeesToHolders = true;
        bytes32 holderSharingEconomics = factory.previewMarketEconomics(params);
        params.expectedEconomics = holderSharingEconomics;
        (bytes32 holderSharingMarket,,,,) = factory.predictMarketAddresses(CREATOR, params);

        assertTrue(holderSharingEconomics != creatorOnlyEconomics);
        assertTrue(holderSharingMarket != creatorOnlyMarket);
        assertEq(factory.previewMarketEconomics(params), holderSharingEconomics);
    }

    function test_enabledCreatorFeesToHoldersRegistersImmutableSharingConfig() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("HOLDER-REGISTER"));
        params.creatorFeesToHolders = true;
        params.expectedEconomics = factory.previewMarketEconomics(params);
        (bytes32 predictedMarket,,,, address predictedLocker) = factory.predictMarketAddresses(CREATOR, params);

        vm.prank(CREATOR);
        (bytes32 marketId,,,) = factory.createMarket{value: LAUNCH_FEE}(params);

        assertEq(marketId, predictedMarket);
        assertEq(treasury.registrationCalls(), 1);
        assertEq(treasury.registeredMarketId(), marketId);
        assertEq(treasury.registeredFeeVault(), address(feeVault));
        assertEq(treasury.registeredLocker(), predictedLocker);
        assertTrue(marketRegistry.market(marketId).config.creatorFeesToHolders);
    }

    function test_revertingCreatorFeesToHoldersRegistrationRollsBackCreation() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("HOLDER-REVERT"));
        params.creatorFeesToHolders = true;
        params.expectedEconomics = factory.previewMarketEconomics(params);
        (bytes32 marketId, address token, address curve, address gauge,) =
            factory.predictMarketAddresses(CREATOR, params);
        treasury.setRejectRegistration(true);

        vm.prank(CREATOR);
        vm.expectRevert(bytes("TREASURY_REGISTRATION_REJECTED"));
        factory.createMarket{value: LAUNCH_FEE}(params);

        assertEq(treasury.registrationCalls(), 0);
        assertEq(token.code.length, 0);
        assertEq(curve.code.length, 0);
        assertEq(gauge.code.length, 0);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 0);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistryV1.MarketNotRegistered.selector, marketId));
        marketRegistry.market(marketId);
    }

    function test_disabledCreatorFeesToHoldersPreservesExistingFlow() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("HOLDER-OFF"));
        assertFalse(params.creatorFeesToHolders);

        vm.prank(CREATOR);
        (bytes32 marketId,,,) = factory.createMarket{value: LAUNCH_FEE}(params);

        assertEq(treasury.registrationCalls(), 0);
        assertFalse(marketRegistry.market(marketId).config.creatorFeesToHolders);
        assertEq(revenueRegistry.currentCreatorEpoch(marketId), 1);
    }

    function test_atomicDeveloperBuyPaysCreatorTaxEvenWhenSnipeExempt() public {
        _setValidConfiguration(address(0));
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ATOMIC-TAX"));
        params.creatorTaxBps = 500;
        params.expectedEconomics = factory.previewMarketEconomics(params);
        uint256 spend = 0.01 ether;
        vm.prank(CREATOR);
        (bytes32 marketId,, uint256 tokensOut, uint256 refund) =
            router.launchAndBuy{value: LAUNCH_FEE + spend}(params, spend, 1, CREATOR);
        TickerGardenCurve c = TickerGardenCurve(payable(marketRegistry.market(marketId).config.curve));
        assertGt(tokensOut, 0);
        assertEq(refund, 0);
        assertEq(c.accruedCreatorTax(), spend * 500 / 10_000);
        assertEq(c.realQuoteReserve(), spend * 9400 / 10_000);
    }

    function test_taxedERC20AtomicBuyAndFailedBuyRollback() public {
        CreateMarketParams memory params = _validParams(CREATOR, bytes32("ERC20-TAX"));
        params.creatorTaxBps = 500;
        params.expectedEconomics = factory.previewMarketEconomics(params);
        uint256 spend = 1_000_000;
        quote.mint(CREATOR, spend);
        vm.prank(CREATOR);
        quote.approve(address(router), spend);
        (, address predictedToken, address predictedCurve,,) = factory.predictMarketAddresses(CREATOR, params);
        vm.prank(CREATOR);
        vm.expectRevert();
        router.launchAndBuy{value: LAUNCH_FEE}(params, spend, type(uint256).max, CREATOR);
        assertEq(predictedToken.code.length, 0);
        assertEq(predictedCurve.code.length, 0);
        assertEq(quote.balanceOf(CREATOR), spend);
        vm.prank(CREATOR);
        (bytes32 marketId,, uint256 tokensOut, uint256 refund) =
            router.launchAndBuy{value: LAUNCH_FEE}(params, spend, 1, CREATOR);
        TickerGardenCurve c = TickerGardenCurve(payable(marketRegistry.market(marketId).config.curve));
        assertGt(tokensOut, 0);
        assertEq(refund, 0);
        assertEq(c.accruedCreatorTax(), 50_000);
        assertEq(c.realQuoteReserve(), 940_000);
        assertEq(quote.balanceOf(address(router)), 0);
    }

    function _validParams(address creator, bytes32 salt) private returns (CreateMarketParams memory params) {
        params = CreateMarketParams({
            assetUid: ASSET_UID,
            tickerGardenBaselineId: BASELINE_ID,
            quoteAssetConfigId: QUOTE_ID,
            launchTemplateId: TEMPLATE_ID,
            expectedEconomics: bytes32(0),
            creatorRevenueBeneficiary: BENEFICIARY,
            name: "Ticker Garden",
            symbol: "GARDEN",
            metadataURI: "ipfs://ticker-garden",
            salt: salt,
            creatorTaxBps: 0,
            creatorFeesToHolders: false,
            stakingEnabled: true
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
