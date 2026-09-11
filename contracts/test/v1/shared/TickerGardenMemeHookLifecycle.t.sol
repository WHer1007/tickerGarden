// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {
    ITickerGardenMemeHook,
    MarketConfig,
    MarketRuntime,
    MarketView,
    PoolBinding,
    PoolKey,
    SwapParams
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {TickerGardenMemeHookBinding} from "../../../src/v1/shared/TickerGardenMemeHookBinding.sol";
import {TickerGardenMemeHookLifecycle} from "../../../src/v1/shared/TickerGardenMemeHookLifecycle.sol";

contract HookLifecycleDependencyMock {}

contract HookLifecycleRegistryMock {
    address public graduationExecutor;
    mapping(bytes32 marketId => MarketView value) private _markets;
    mapping(bytes32 marketId => PoolKey key) private _keys;

    function setGraduationExecutor(address value) external {
        graduationExecutor = value;
    }

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

contract HookLifecycleCreate2Deployer {
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

contract HookLifecycleGraduationMock {
    function register(ITickerGardenMemeHook hook, bytes32 marketId, PoolKey calldata key, uint32 version)
        external
        returns (bytes32)
    {
        return hook.registerExpectedPool(marketId, key, version);
    }

    function activate(ITickerGardenMemeHook hook, bytes32 poolId) external {
        hook.activatePool(poolId);
    }

    function graduateThenRevert(
        ITickerGardenMemeHook hook,
        HookLifecyclePoolManagerMock poolManager,
        bytes32 marketId,
        PoolKey calldata key,
        uint32 version
    ) external {
        bytes32 poolId = hook.registerExpectedPool(marketId, key, version);
        poolManager.initialize(hook, key);
        hook.activatePool(poolId);
        revert("GRADUATION_FAILED");
    }
}

contract HookLifecyclePoolManagerMock {
    function initialize(ITickerGardenMemeHook hook, PoolKey calldata key) external returns (bytes4) {
        return hook.beforeInitialize(address(this), key, 1 << 96);
    }

    function initializeThenRevert(ITickerGardenMemeHook hook, PoolKey calldata key) external {
        hook.beforeInitialize(address(this), key, 1 << 96);
        revert("INITIALIZE_FAILED");
    }

    function swap(ITickerGardenMemeHook hook, PoolKey calldata key) external returns (bytes4, int128) {
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        return hook.afterSwap(address(this), key, params, 0, "untrusted");
    }
}

contract TickerGardenMemeHookLifecycleHarness is TickerGardenMemeHookLifecycle {
    function convertRewards(bytes32, uint256, uint256) external pure override returns (uint256, uint256) {
        revert("UNSUPPORTED_TEST_LAYER");
    }

    function unlockCallback(bytes calldata) external pure override returns (bytes memory) {
        revert("UNSUPPORTED_TEST_LAYER");
    }

    constructor(address registry, address poolManager, address feeVault, address graduation)
        TickerGardenMemeHookLifecycle(registry, poolManager, feeVault, graduation)
    {}

    function afterSwap(address, PoolKey calldata key, SwapParams calldata, int256, bytes calldata)
        external
        override
        returns (bytes4, int128)
    {
        _validateActivePool(key);
        return (ITickerGardenMemeHook.afterSwap.selector, 0);
    }
}

contract TickerGardenMemeHookLifecycleTest is Test {
    uint160 private constant MASK = 0x2044;
    uint160 private constant ALL_BITS = (1 << 14) - 1;
    bytes32 private constant MARKET_ID = keccak256("hook-lifecycle-market");
    address private constant QUOTE = address(0);
    address private constant MEME = address(0xBEEF);

    HookLifecycleRegistryMock private registry;
    HookLifecyclePoolManagerMock private poolManager;
    HookLifecycleDependencyMock private feeVault;
    HookLifecycleGraduationMock private graduation;
    HookLifecycleCreate2Deployer private deployer;
    TickerGardenMemeHookLifecycleHarness private hook;
    PoolKey private key;

    function setUp() public {
        registry = new HookLifecycleRegistryMock();
        poolManager = new HookLifecyclePoolManagerMock();
        feeVault = new HookLifecycleDependencyMock();
        graduation = new HookLifecycleGraduationMock();
        deployer = new HookLifecycleCreate2Deployer();
        registry.setGraduationExecutor(address(graduation));
        hook = _deployHook();
        key = PoolKey({currency0: QUOTE, currency1: MEME, fee: 0, tickSpacing: 60, hooks: address(hook)});
        _configure(0, bytes32(0), 1, key);
    }

    function test_beforeInitializeConsumesExpectedBindingExactlyOnce() public {
        bytes32 poolId = _register();
        assertEq(poolManager.initialize(hook, key), ITickerGardenMemeHook.beforeInitialize.selector);
        assertEq(hook.poolBinding(poolId).status, 2);

        vm.expectRevert(abi.encodeWithSelector(TickerGardenMemeHookBinding.PoolNotExpected.selector, poolId));
        poolManager.initialize(hook, key);
    }

    function test_beforeInitializeOnlyAcceptsPoolManagerAndExactExpectedKey() public {
        bytes32 poolId = _register();
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookBinding.UnauthorizedHookCaller.selector, address(this), address(poolManager)
            )
        );
        hook.beforeInitialize(address(this), key, 1 << 96);

        PoolKey memory wrongKey = key;
        wrongKey.tickSpacing = 61;
        bytes32 wrongPoolId = keccak256(abi.encode(wrongKey));
        vm.expectRevert(abi.encodeWithSelector(TickerGardenMemeHookBinding.PoolNotExpected.selector, wrongPoolId));
        poolManager.initialize(hook, wrongKey);
        assertEq(hook.poolBinding(poolId).status, 1);
    }

    function test_beforeInitializeFailsClosedOnRegistryLifecycleVersionAndCanonicalDrift() public {
        bytes32 poolId = _register();
        _configure(1, poolId, 2, key);
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenMemeHookBinding.InactiveFeeSource.selector, MARKET_ID, uint32(2))
        );
        poolManager.initialize(hook, key);

        _configure(0, bytes32(0), 2, key);
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenMemeHookBinding.InactiveFeeSource.selector, MARKET_ID, uint32(2))
        );
        poolManager.initialize(hook, key);

        PoolKey memory canonical = key;
        canonical.tickSpacing = 120;
        _configure(0, bytes32(0), 1, canonical);
        vm.expectRevert(TickerGardenMemeHookBinding.InvalidCanonicalPoolKey.selector);
        poolManager.initialize(hook, key);
        assertEq(hook.poolBinding(poolId).status, 1);
    }

    function test_initializeDownstreamRevertRollsHandshakeBackToExpected() public {
        bytes32 poolId = _register();
        vm.expectRevert(bytes("INITIALIZE_FAILED"));
        poolManager.initializeThenRevert(hook, key);
        assertEq(hook.poolBinding(poolId).status, 1);
    }

    function test_atomicGraduationFailureRollsBackRegisterInitializeAndActivate() public {
        bytes32 poolId = keccak256(abi.encode(key));
        vm.expectRevert(bytes("GRADUATION_FAILED"));
        graduation.graduateThenRevert(hook, poolManager, MARKET_ID, key, 2);

        assertEq(hook.marketOfPool(poolId), bytes32(0));
        assertEq(hook.poolBinding(poolId).status, 0);
    }

    function test_activateRequiresGraduationInitializeSeenAndPreCommitRegistryState() public {
        bytes32 poolId = _register();
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookLifecycle.InvalidPoolBindingTransition.selector, poolId, uint8(1), uint8(2)
            )
        );
        graduation.activate(hook, poolId);

        poolManager.initialize(hook, key);
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookBinding.UnauthorizedHookCaller.selector, address(this), address(graduation)
            )
        );
        hook.activatePool(poolId);

        _configure(1, poolId, 2, key);
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenMemeHookBinding.InactiveFeeSource.selector, MARKET_ID, uint32(2))
        );
        graduation.activate(hook, poolId);

        PoolKey memory wrongCanonical = key;
        wrongCanonical.tickSpacing = 120;
        _configure(0, bytes32(0), 1, wrongCanonical);
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenMemeHookBinding.InactiveFeeSource.selector, MARKET_ID, uint32(2))
        );
        graduation.activate(hook, poolId);
        assertEq(hook.poolBinding(poolId).status, 2);
    }

    function test_activateEmitsAndOnlyBecomesUsableAfterRegistryCommit() public {
        bytes32 poolId = _initialize();
        vm.expectEmit(true, true, false, true, address(hook));
        emit ITickerGardenMemeHook.PoolBindingActivated(MARKET_ID, poolId, 2);
        graduation.activate(hook, poolId);

        PoolBinding memory binding = hook.poolBinding(poolId);
        assertEq(binding.status, 3);
        assertEq(binding.sourceVersion, 2);
        assertEq(binding.feeNonce, 0);
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenMemeHookBinding.InactiveFeeSource.selector, MARKET_ID, uint32(2))
        );
        poolManager.swap(hook, key);

        _configure(1, poolId, 2, key);
        (bytes4 selector, int128 delta) = poolManager.swap(hook, key);
        assertEq(selector, ITickerGardenMemeHook.afterSwap.selector);
        assertEq(delta, 0);
    }

    function test_oldDisableSelectorHasNoCallableSurface() public {
        _activateAndCommit();
        (bool success,) =
            address(hook).call(abi.encodeWithSignature("disablePool(bytes32)", keccak256(abi.encode(key))));
        assertFalse(success);
    }

    function _register() private returns (bytes32) {
        return graduation.register(hook, MARKET_ID, key, 2);
    }

    function _initialize() private returns (bytes32 poolId) {
        poolId = _register();
        poolManager.initialize(hook, key);
    }

    function _activateAndCommit() private returns (bytes32 poolId) {
        poolId = _initialize();
        graduation.activate(hook, poolId);
        _configure(1, poolId, 2, key);
    }

    function _configure(uint8 phase, bytes32 poolId, uint32 version, PoolKey memory canonical) private {
        _configureFor(hook, phase, poolId, version, canonical);
    }

    function _configureFor(
        TickerGardenMemeHookLifecycleHarness target,
        uint8 phase,
        bytes32 poolId,
        uint32 version,
        PoolKey memory canonical
    ) private {
        MarketConfig memory config;
        config.quoteAsset = QUOTE;
        config.memeToken = MEME;
        config.graduatedHook = address(target);
        MarketRuntime memory runtime;
        runtime.launchPhase = phase;
        runtime.poolId = poolId;
        runtime.sourceVersion = version;
        registry.configure(MARKET_ID, MarketView({config: config, runtime: runtime}), canonical);
    }

    function _deployHook() private returns (TickerGardenMemeHookLifecycleHarness result) {
        bytes memory initCode = abi.encodePacked(
            type(TickerGardenMemeHookLifecycleHarness).creationCode,
            abi.encode(address(registry), address(poolManager), address(feeVault), address(graduation))
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt;
        for (uint256 nonce; nonce < 100_000; ++nonce) {
            salt = bytes32(nonce);
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(deployer), salt, initCodeHash))))
            );
            if (uint160(predicted) & ALL_BITS == MASK && predicted.code.length == 0) {
                return TickerGardenMemeHookLifecycleHarness(deployer.deploy(initCode, salt));
            }
        }
        revert("HOOK_SALT_NOT_FOUND");
    }
}
