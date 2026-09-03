// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {
    ITickerGardenMemeHook,
    MarketConfig,
    MarketRuntime,
    MarketView,
    PoolBinding,
    PoolKey,
    SwapParams
} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {TickerGardenMemeHookBinding} from "../../../src/v2/shared/TickerGardenMemeHookBinding.sol";

contract HookDependencyMock {}

contract HookMarketRegistryMock {
    mapping(bytes32 marketId => MarketView value) private _markets;
    mapping(bytes32 marketId => PoolKey key) private _keys;

    function configure(bytes32 marketId, MarketView calldata value, PoolKey calldata key) external {
        _markets[marketId] = value;
        _keys[marketId] = key;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }

    function canonicalPoolKey(bytes32 marketId) external view returns (PoolKey memory) {
        return _keys[marketId];
    }
}

contract HookCreate2Deployer {
    function deploy(bytes memory initCode, bytes32 salt) external returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
            if iszero(deployed) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }
}

contract HookGraduationModuleMock {
    function register(ITickerGardenMemeHook hook, bytes32 marketId, PoolKey calldata key, uint32 sourceVersion)
        external
        returns (bytes32)
    {
        return hook.registerExpectedPool(marketId, key, sourceVersion);
    }

    function activate(ITickerGardenMemeHook hook, bytes32 poolId) external {
        hook.activatePool(poolId);
    }
}

contract HookPoolManagerMock {
    function initialize(ITickerGardenMemeHook hook, PoolKey calldata key) external returns (bytes4) {
        return hook.beforeInitialize(address(this), key, 1 << 96);
    }

    function swap(ITickerGardenMemeHook hook, PoolKey calldata key, bytes calldata hookData)
        external
        returns (bytes4 selector, int128 hookDelta)
    {
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        return hook.afterSwap(address(this), key, params, 0, hookData);
    }
}

contract TickerGardenMemeHookBindingHarness is TickerGardenMemeHookBinding {
    constructor(address registry, address poolManager, address feeVault, address graduation, address controller)
        TickerGardenMemeHookBinding(registry, poolManager, feeVault, graduation, controller)
    {}

    function activatePool(bytes32 poolId) external override {
        _requireHookCaller(_hookGraduationExecutor);
        PoolBinding storage binding = _poolBindings[poolId];
        if (binding.status != BINDING_EXPECTED) revert PoolNotExpected(poolId);
        binding.status = BINDING_ACTIVE;
    }

    function disablePool(bytes32 poolId) external override {
        _requireHookCaller(_hookMarketController);
        PoolBinding storage binding = _poolBindings[poolId];
        if (binding.status != BINDING_ACTIVE) revert PoolBindingNotActive(poolId);
        binding.status = BINDING_DISABLED;
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external override returns (bytes4) {
        _requireHookCaller(_hookPoolManager);
        return ITickerGardenMemeHook.beforeInitialize.selector;
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata, int256, bytes calldata)
        external
        override
        returns (bytes4, int128)
    {
        _validateActivePool(key);
        return (ITickerGardenMemeHook.afterSwap.selector, 0);
    }
}

contract TickerGardenMemeHookBindingTest is Test {
    uint160 private constant MASK = 0x2044;
    uint160 private constant ALL_BITS = (1 << 14) - 1;
    bytes32 private constant MARKET_ID = keccak256("hook-binding-market");
    address private constant QUOTE = address(0);
    address private constant MEME = address(0xBEEF);

    HookMarketRegistryMock private registry;
    HookPoolManagerMock private poolManager;
    HookDependencyMock private feeVault;
    HookGraduationModuleMock private graduation;
    HookDependencyMock private controller;
    HookCreate2Deployer private deployer;
    TickerGardenMemeHookBindingHarness private hook;
    PoolKey private key;

    function setUp() public {
        registry = new HookMarketRegistryMock();
        poolManager = new HookPoolManagerMock();
        feeVault = new HookDependencyMock();
        graduation = new HookGraduationModuleMock();
        controller = new HookDependencyMock();
        deployer = new HookCreate2Deployer();
        hook = _deployHook(
            address(registry), address(poolManager), address(feeVault), address(graduation), address(controller)
        );
        key = PoolKey({currency0: QUOTE, currency1: MEME, fee: 0, tickSpacing: 60, hooks: address(hook)});
        _configure(1, 0, bytes32(0), key);
    }

    function test_create2DeploymentHasExactlyTheFrozenPermissionBits() public view {
        assertEq(uint160(address(hook)) & ALL_BITS, MASK);
        assertEq(hook.hookPermissionMask(), MASK);
        assertEq(MASK, (1 << 13) | (1 << 6) | (1 << 2));
    }

    function test_constructorRejectsWrongAddressBitsBeforeAcceptingDependencies() public {
        bytes memory initCode = _initCode(
            address(registry), address(poolManager), address(feeVault), address(graduation), address(controller)
        );
        bytes32 salt;
        while (uint160(_predicted(salt, keccak256(initCode))) & ALL_BITS == MASK) {
            salt = bytes32(uint256(salt) + 1);
        }
        vm.expectRevert(TickerGardenMemeHookBinding.InvalidHookPermissionMask.selector);
        deployer.deploy(initCode, salt);
    }

    function test_constructorRejectsNoCodeAndAliasedDependenciesAtAValidHookAddress() public {
        bytes memory noCodeInit = _initCode(
            address(0xBAD), address(poolManager), address(feeVault), address(graduation), address(controller)
        );
        bytes32 noCodeSalt = _mineSalt(keccak256(noCodeInit));
        vm.expectRevert();
        deployer.deploy(noCodeInit, noCodeSalt);

        bytes memory aliasInit = _initCode(
            address(registry), address(poolManager), address(poolManager), address(graduation), address(controller)
        );
        bytes32 aliasSalt = _mineSalt(keccak256(aliasInit));
        vm.expectRevert();
        deployer.deploy(aliasInit, aliasSalt);
    }

    function test_onlyGraduationModuleCanRegisterExpectedPool() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookBinding.UnauthorizedHookCaller.selector, address(this), address(graduation)
            )
        );
        hook.registerExpectedPool(MARKET_ID, key, 2);
    }

    function test_registerBindsCanonicalFiveFieldKeyPoolIdAndNextSourceVersion() public {
        bytes32 poolId = keccak256(abi.encode(key));
        vm.expectEmit(true, true, false, true, address(hook));
        emit ITickerGardenMemeHook.ExpectedPoolRegistered(MARKET_ID, poolId, poolId, 2);
        assertEq(graduation.register(hook, MARKET_ID, key, 2), poolId);

        assertEq(hook.marketOfPool(poolId), MARKET_ID);
        PoolBinding memory binding = hook.poolBinding(poolId);
        assertEq(binding.marketId, MARKET_ID);
        assertEq(binding.keyHash, poolId);
        assertEq(binding.sourceVersion, 2);
        assertEq(binding.feeNonce, 0);
        assertEq(binding.status, 1);
    }

    function test_wrongSourceVersionOrLifecycleCannotRegister() public {
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenMemeHookBinding.InactiveFeeSource.selector, MARKET_ID, uint32(1))
        );
        graduation.register(hook, MARKET_ID, key, 1);

        _configure(0, 0, bytes32(0), key);
        vm.expectRevert();
        graduation.register(hook, MARKET_ID, key, 2);

        _configure(1, 1, bytes32(0), key);
        vm.expectRevert();
        graduation.register(hook, MARKET_ID, key, 2);
    }

    function test_sourceVersionOverflowFailsClosed() public {
        _configure(1, 0, bytes32(0), key, type(uint32).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookBinding.HookSourceVersionOverflow.selector, MARKET_ID, type(uint32).max
            )
        );
        graduation.register(hook, MARKET_ID, key, type(uint32).max);
    }

    function test_everyPoolKeyFieldAndRegistryCanonicalKeyMustMatch() public {
        PoolKey memory changed = key;
        changed.currency0 = address(1);
        _expectInvalidKey(changed);
        changed = key;
        changed.currency1 = address(0xCAFE);
        _expectInvalidKey(changed);
        changed = key;
        changed.fee = 1;
        _expectInvalidKey(changed);
        changed = key;
        changed.tickSpacing = 61;
        _expectInvalidKey(changed);
        changed = key;
        changed.hooks = address(uint160(address(hook)) + 1);
        _expectInvalidKey(changed);

        PoolKey memory wrongCanonical = key;
        wrongCanonical.tickSpacing = 120;
        _configure(1, 0, bytes32(0), wrongCanonical);
        _expectInvalidKey(key);
    }

    function test_duplicateExpectedRegistrationCannotOverwriteBinding() public {
        bytes32 poolId = graduation.register(hook, MARKET_ID, key, 2);
        vm.expectRevert(abi.encodeWithSelector(TickerGardenMemeHookBinding.PoolNotExpected.selector, poolId));
        graduation.register(hook, MARKET_ID, key, 2);
        assertEq(hook.poolBinding(poolId).status, 1);
    }

    function test_onlyPoolManagerCanEnterCallbacksAndExpectedBindingCannotSwap() public {
        graduation.register(hook, MARKET_ID, key, 2);
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookBinding.UnauthorizedHookCaller.selector, address(this), address(poolManager)
            )
        );
        hook.afterSwap(address(this), key, params, 0, "");

        vm.expectRevert();
        poolManager.swap(hook, key, "untrusted-hook-data");
    }

    function test_activeGuardUsesStoredBindingAndIgnoresUntrustedHookData() public {
        bytes32 poolId = graduation.register(hook, MARKET_ID, key, 2);
        _configure(2, 0, poolId, key, 2);
        graduation.activate(hook, poolId);

        (bytes4 selector, int128 delta) = poolManager.swap(hook, key, abi.encode(MARKET_ID, address(0xBAD)));
        assertEq(selector, ITickerGardenMemeHook.afterSwap.selector);
        assertEq(delta, 0);
    }

    function test_activeGuardRejectsWrongFullKeyAndRegistrySourceDrift() public {
        bytes32 poolId = graduation.register(hook, MARKET_ID, key, 2);
        _configure(2, 0, poolId, key, 2);
        graduation.activate(hook, poolId);

        PoolKey memory changed = key;
        changed.tickSpacing = 61;
        vm.expectRevert();
        poolManager.swap(hook, changed, "");

        _configure(2, 0, poolId, key, 3);
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenMemeHookBinding.InactiveFeeSource.selector, MARKET_ID, uint32(2))
        );
        poolManager.swap(hook, key, "");
    }

    function test_unenabledCallbackSelectorsHaveNoCallableSurface() public {
        bytes4[8] memory forbidden = [
            IHooks.afterInitialize.selector,
            IHooks.beforeAddLiquidity.selector,
            IHooks.afterAddLiquidity.selector,
            IHooks.beforeRemoveLiquidity.selector,
            IHooks.afterRemoveLiquidity.selector,
            IHooks.beforeSwap.selector,
            IHooks.beforeDonate.selector,
            IHooks.afterDonate.selector
        ];
        for (uint256 i; i < forbidden.length; ++i) {
            (bool success,) = address(hook).call(abi.encodePacked(forbidden[i]));
            assertFalse(success);
        }
    }

    function _expectInvalidKey(PoolKey memory supplied) private {
        vm.expectRevert(TickerGardenMemeHookBinding.InvalidCanonicalPoolKey.selector);
        graduation.register(hook, MARKET_ID, supplied, 2);
    }

    function _configure(uint8 launchPhase, uint8 marketStatus, bytes32 poolId, PoolKey memory canonicalKey) private {
        _configure(launchPhase, marketStatus, poolId, canonicalKey, 1);
    }

    function _configure(
        uint8 launchPhase,
        uint8 marketStatus,
        bytes32 poolId,
        PoolKey memory canonicalKey,
        uint32 sourceVersion
    ) private {
        MarketConfig memory config;
        config.quoteAsset = QUOTE;
        config.memeToken = MEME;
        config.graduatedHook = address(hook);
        MarketRuntime memory runtime;
        runtime.launchPhase = launchPhase;
        runtime.marketStatus = marketStatus;
        runtime.poolId = poolId;
        runtime.sourceVersion = sourceVersion;
        registry.configure(MARKET_ID, MarketView({config: config, runtime: runtime}), canonicalKey);
    }

    function _deployHook(
        address registry_,
        address poolManager_,
        address feeVault_,
        address graduation_,
        address controller_
    ) private returns (TickerGardenMemeHookBindingHarness result) {
        bytes memory initCode = _initCode(registry_, poolManager_, feeVault_, graduation_, controller_);
        bytes32 salt = _mineSalt(keccak256(initCode));
        result = TickerGardenMemeHookBindingHarness(deployer.deploy(initCode, salt));
    }

    function _initCode(
        address registry_,
        address poolManager_,
        address feeVault_,
        address graduation_,
        address controller_
    ) private pure returns (bytes memory) {
        return abi.encodePacked(
            type(TickerGardenMemeHookBindingHarness).creationCode,
            abi.encode(registry_, poolManager_, feeVault_, graduation_, controller_)
        );
    }

    function _mineSalt(bytes32 initCodeHash) private view returns (bytes32 salt) {
        for (uint256 nonce; nonce < 100_000; ++nonce) {
            salt = bytes32(nonce);
            if (uint160(_predicted(salt, initCodeHash)) & ALL_BITS == MASK) return salt;
        }
        revert("HOOK_SALT_NOT_FOUND");
    }

    function _predicted(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(deployer), salt, initCodeHash)))));
    }
}
