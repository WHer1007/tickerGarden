// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {MarketConfig, MarketRuntime, MarketView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {MarketController, MarketControllerInit} from "../../../src/v2/modules/MarketController.sol";
import {ProtocolFeeVaultRecoveryCaps} from "../../../src/v2/shared/ProtocolFeeVaultRecoveryCaps.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

interface IRecoveryCapView {
    function recoveryCap(bytes32, uint32, address) external view returns (uint256);
}

contract EmergencyRegistryMock {
    MarketView private _market;
    address public controller;
    address public feeVault;
    EmergencyGaugeMock public gauge;
    EmergencyHookMock public hook;

    error EmergencyNotReady(uint64 readyAt);

    function configure(
        bytes32 assetUid,
        address quote,
        address meme,
        EmergencyGaugeMock gauge_,
        EmergencyHookMock hook_,
        address controller_,
        address feeVault_,
        uint64 restrictedSince
    ) external {
        _market.config.assetUid = assetUid;
        _market.config.quoteAsset = quote;
        _market.config.memeToken = meme;
        _market.config.gauge = address(gauge_);
        _market.config.graduatedHook = address(hook_);
        _market.config.marketController = controller_;
        _market.runtime.poolId = keccak256("emergency-pool");
        _market.runtime.sourceVersion = 7;
        _market.runtime.recoveryEpoch = 2;
        _market.runtime.restrictedSince = restrictedSince;
        _market.runtime.launchPhase = 2;
        _market.runtime.marketStatus = 1;
        controller = controller_;
        feeVault = feeVault_;
        gauge = gauge_;
        hook = hook_;
    }

    function market(bytes32) external view returns (MarketView memory) {
        return _market;
    }

    function commitEmergencyExit(bytes32 marketId, uint64 snapshotBlock, bytes32 stateHash) external returns (uint32) {
        require(msg.sender == controller, "CONTROLLER");
        uint64 readyAt = _market.runtime.restrictedSince + 1 days;
        if (block.timestamp < readyAt) revert EmergencyNotReady(readyAt);
        require(IRecoveryCapView(feeVault).recoveryCap(marketId, 3, _market.config.quoteAsset) == 20, "QUOTE_CAP");
        require(IRecoveryCapView(feeVault).recoveryCap(marketId, 3, _market.config.memeToken) == 30, "MEME_CAP");
        require(gauge.disabled() && hook.disabled(), "ORDER");
        require(snapshotBlock == block.number - 1 && stateHash != bytes32(0), "SNAPSHOT");
        _market.runtime.marketStatus = 3;
        _market.runtime.sourceVersion = 8;
        _market.runtime.recoveryEpoch = 3;
        return 3;
    }
}

contract EmergencyGaugeMock {
    bytes32 public immutable marketId;
    address public controller;
    address public feeVault;
    address public quote;
    address public meme;
    bool public disabled;

    constructor(bytes32 marketId_, address quote_, address meme_) {
        marketId = marketId_;
        quote = quote_;
        meme = meme_;
    }

    function bind(address controller_, address feeVault_) external {
        controller = controller_;
        feeVault = feeVault_;
    }

    function storedTotalActiveStock() external pure returns (uint256) {
        return 41;
    }

    function totalPendingStock() external pure returns (uint256) {
        return 9;
    }

    function disableForEmergency(uint32 epoch, uint64 snapshotBlock, bytes32 stateHash) external {
        require(msg.sender == controller, "CONTROLLER");
        require(IRecoveryCapView(feeVault).recoveryCap(marketId, epoch, quote) == 20, "QUOTE_CAP_FIRST");
        require(IRecoveryCapView(feeVault).recoveryCap(marketId, epoch, meme) == 30, "MEME_CAP_FIRST");
        require(snapshotBlock == block.number - 1 && stateHash != bytes32(0), "SNAPSHOT");
        disabled = true;
    }
}

contract EmergencyHookMock {
    EmergencyGaugeMock public immutable gauge;
    address public controller;
    bool public disabled;

    constructor(EmergencyGaugeMock gauge_) {
        gauge = gauge_;
    }

    function bind(address controller_) external {
        controller = controller_;
    }

    function disablePool(bytes32 poolId) external {
        require(msg.sender == controller, "CONTROLLER");
        require(gauge.disabled(), "GAUGE_FIRST");
        require(poolId == keccak256("emergency-pool"), "POOL");
        disabled = true;
    }
}

contract EmergencyEmptyDependency {}

contract EmergencyRecoveryCapsHarness is ProtocolFeeVaultRecoveryCaps {
    constructor(
        address registry,
        address poolManager,
        address creatorRegistry,
        address treasury,
        bytes32 feePolicyId,
        address controller
    ) ProtocolFeeVaultRecoveryCaps(registry, poolManager, creatorRegistry, treasury, feePolicyId, controller) {}

    function creditStaker(bytes32 marketId, address feeAsset, uint256 amount) external {
        _creditFeeLiabilities(marketId, 1, feeAsset, amount, 0, amount, 0);
    }
}

contract MarketControllerEmergencyTest is Test {
    uint64 private constant RECOVERY_ROLE = 4;
    uint32 private constant RECOVERY_DELAY = 1 days;
    bytes32 private constant MARKET_ID = keccak256("emergency-market");
    bytes32 private constant ASSET_UID = keccak256("emergency-stock");
    address private constant RECOVERY_OPERATOR = address(0xBEEF);

    AccessManager private manager;
    EmergencyRegistryMock private registry;
    MockExactQuoteToken private quote;
    MockExactQuoteToken private meme;
    EmergencyGaugeMock private gauge;
    EmergencyHookMock private hook;
    EmergencyRecoveryCapsHarness private feeVault;
    MarketController private controller;

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(10_000);
        manager = new AccessManager(address(this));
        registry = new EmergencyRegistryMock();
        quote = new MockExactQuoteToken(6);
        meme = new MockExactQuoteToken(18);
        gauge = new EmergencyGaugeMock(MARKET_ID, address(quote), address(meme));
        hook = new EmergencyHookMock(gauge);
        EmergencyEmptyDependency poolManager = new EmergencyEmptyDependency();
        EmergencyEmptyDependency creatorRegistry = new EmergencyEmptyDependency();
        EmergencyEmptyDependency treasury = new EmergencyEmptyDependency();
        EmergencyEmptyDependency stockRegistry = new EmergencyEmptyDependency();

        uint256 nonce = vm.getNonce(address(this));
        address predictedController = vm.computeCreateAddress(address(this), nonce + 1);
        feeVault = new EmergencyRecoveryCapsHarness(
            address(registry),
            address(poolManager),
            address(creatorRegistry),
            address(treasury),
            keccak256("emergency-fee-policy"),
            predictedController
        );
        controller = new MarketController(
            MarketControllerInit({
                authority: address(manager),
                marketRegistry: address(registry),
                officialStockRegistry: address(stockRegistry),
                protocolFeeVault: address(feeVault)
            })
        );
        assertEq(address(controller), predictedController);

        registry.configure(
            ASSET_UID,
            address(quote),
            address(meme),
            gauge,
            hook,
            address(controller),
            address(feeVault),
            uint64(block.timestamp)
        );
        gauge.bind(address(controller), address(feeVault));
        hook.bind(address(controller));
        quote.mint(address(feeVault), 20);
        meme.mint(address(feeVault), 30);
        feeVault.creditStaker(MARKET_ID, address(quote), 20);
        feeVault.creditStaker(MARKET_ID, address(meme), 30);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MarketController.activateEmergencyExit.selector;
        manager.setTargetFunctionRole(address(controller), selectors, RECOVERY_ROLE);
        manager.grantRole(RECOVERY_ROLE, RECOVERY_OPERATOR, RECOVERY_DELAY);
    }

    function test_singleArgumentEmergencyFreezesCapsDisablesGaugeThenHookAndCommitsLast() public {
        bytes memory data = abi.encodeCall(MarketController.activateEmergencyExit, (MARKET_ID));
        uint48 readyAt = uint48(block.timestamp + RECOVERY_DELAY);
        vm.prank(RECOVERY_OPERATOR);
        manager.schedule(address(controller), data, readyAt);

        vm.warp(readyAt - 1);
        vm.prank(RECOVERY_OPERATOR);
        vm.expectRevert();
        manager.execute(address(controller), data);
        assertFalse(gauge.disabled());
        assertFalse(hook.disabled());
        assertEq(feeVault.recoveryCap(MARKET_ID, 3, address(quote)), 0);

        vm.warp(readyAt);
        vm.prank(RECOVERY_OPERATOR);
        manager.execute(address(controller), data);

        assertTrue(gauge.disabled());
        assertTrue(hook.disabled());
        MarketView memory value = registry.market(MARKET_ID);
        assertEq(value.runtime.marketStatus, 3);
        assertEq(value.runtime.sourceVersion, 8);
        assertEq(value.runtime.recoveryEpoch, 3);
        (uint64 snapshotBlock, bytes32 stateHash) = feeVault.recoverySnapshot(MARKET_ID, 3);
        assertEq(snapshotBlock, block.number - 1);
        assertEq(feeVault.recoveryCap(MARKET_ID, 3, address(quote)), 20);
        assertEq(feeVault.recoveryCap(MARKET_ID, 3, address(meme)), 30);
        assertEq(stateHash, _expectedStateHash(snapshotBlock));
    }

    function _expectedStateHash(uint64 snapshotBlock) private view returns (bytes32) {
        bytes32[16] memory words;
        words[0] = keccak256("TICKERGARDEN_V2_EMERGENCY_STATE_V1");
        words[1] = bytes32(uint256(1));
        words[2] = bytes32(block.chainid);
        words[3] = bytes32(uint256(uint160(address(registry))));
        words[4] = bytes32(uint256(uint160(address(feeVault))));
        words[5] = MARKET_ID;
        words[6] = bytes32(uint256(3));
        words[7] = bytes32(uint256(snapshotBlock));
        words[8] = bytes32(uint256(uint160(address(gauge))));
        words[9] = bytes32(uint256(7));
        words[10] = bytes32(uint256(uint160(address(quote))));
        words[11] = bytes32(uint256(uint160(address(meme))));
        words[12] = bytes32(uint256(20));
        words[13] = bytes32(uint256(30));
        words[14] = bytes32(uint256(41));
        words[15] = bytes32(uint256(9));
        return keccak256(abi.encodePacked(words));
    }
}
