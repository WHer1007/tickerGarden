// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {AssetView, IMarketController, MarketView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {MarketController, MarketControllerInit} from "../../../src/v2/modules/MarketController.sol";
import {ImmutableAccessManaged} from "../../../src/v2/shared/ImmutableAccessManaged.sol";

contract ControllerRegistryMock {
    MarketView private _market;
    bytes32 public lastMarketId;
    bytes32 public lastReasonHash;

    error InvalidTransition(uint8 currentStatus, uint8 requestedStatus);

    constructor(bytes32 assetUid) {
        _market.config.assetUid = assetUid;
        _market.config.gauge = address(0x6000);
        _market.config.memeToken = address(0xA000);
        _market.runtime.launchPhase = 2;
        _market.runtime.marketStatus = 0;
        _market.runtime.sourceVersion = 1;
    }

    function setRuntime(uint8 launchPhase_, uint8 marketStatus_) external {
        _market.runtime.launchPhase = launchPhase_;
        _market.runtime.marketStatus = marketStatus_;
    }

    function market(bytes32) external view returns (MarketView memory) {
        return _market;
    }

    function setMarketPaused(bytes32 marketId, bytes32 reasonHash) external {
        if (_market.runtime.marketStatus != 0) revert InvalidTransition(_market.runtime.marketStatus, 1);
        lastMarketId = marketId;
        lastReasonHash = reasonHash;
        _market.runtime.marketStatus = 1;
    }

    function setMarketActive(bytes32) external {
        if (_market.runtime.marketStatus != 1) revert InvalidTransition(_market.runtime.marketStatus, 0);
        _market.runtime.marketStatus = 0;
    }

    function setMarketRetired(bytes32 marketId, bytes32 reasonHash) external {
        uint8 status = _market.runtime.marketStatus;
        if (status != 0 && status != 1) revert InvalidTransition(status, 2);
        lastMarketId = marketId;
        lastReasonHash = reasonHash;
        _market.runtime.marketStatus = 2;
    }
}

contract ControllerStockRegistryMock {
    mapping(bytes32 assetUid => AssetView value) private _assets;

    function setStatus(bytes32 assetUid, uint8 status) external {
        _assets[assetUid].status = status;
    }

    function asset(bytes32 assetUid) external view returns (AssetView memory) {
        return _assets[assetUid];
    }
}

contract EmptyControllerDependency {}

contract MarketControllerTest is Test {
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    uint64 internal constant PAUSE_GUARDIAN_ROLE = 2;
    uint64 internal constant UNPAUSE_ROLE = 3;
    uint64 internal constant RECOVERY_ROLE = 4;
    uint32 internal constant RETIRE_DELAY = 2 days;
    uint32 internal constant UNPAUSE_DELAY = 1 days;

    bytes32 internal constant MARKET_ID = keccak256("controller-market");
    bytes32 internal constant ASSET_UID = keccak256("controller-stock");
    bytes32 internal constant REASON_HASH = keccak256("controller-reason");
    address internal constant GUARDIAN = address(0x6A7D);
    address internal constant UNPAUSER = address(0xBEEF);
    address internal constant ADMIN = address(0xAD01);

    AccessManager internal manager;
    ControllerRegistryMock internal registry;
    ControllerStockRegistryMock internal stockRegistry;
    EmptyControllerDependency internal feeVault;
    MarketController internal controller;

    event MarketStatusChanged(bytes32 indexed marketId, uint8 oldStatus, uint8 newStatus, bytes32 reasonHash);

    function setUp() public {
        vm.warp(1_000_000);
        manager = new AccessManager(address(this));
        registry = new ControllerRegistryMock(ASSET_UID);
        stockRegistry = new ControllerStockRegistryMock();
        feeVault = new EmptyControllerDependency();
        stockRegistry.setStatus(ASSET_UID, 1);
        controller = _deploy(address(manager), address(registry), address(stockRegistry), address(feeVault));

        _setRole(IMarketController.pauseMarket.selector, PAUSE_GUARDIAN_ROLE);
        _setRole(IMarketController.unpauseMarket.selector, UNPAUSE_ROLE);
        _setRole(IMarketController.retireMarket.selector, PROTOCOL_ADMIN_ROLE);
        _setRole(IMarketController.activateEmergencyExit.selector, RECOVERY_ROLE);
        manager.grantRole(PAUSE_GUARDIAN_ROLE, GUARDIAN, 0);
        manager.grantRole(UNPAUSE_ROLE, UNPAUSER, UNPAUSE_DELAY);
        manager.grantRole(PROTOCOL_ADMIN_ROLE, ADMIN, RETIRE_DELAY);
    }

    function test_pauseIsImmediateAndForwardsReasonWithCanonicalEvent() public {
        vm.expectEmit(true, false, false, true, address(controller));
        emit MarketStatusChanged(MARKET_ID, 0, 1, REASON_HASH);
        vm.prank(GUARDIAN);
        controller.pauseMarket(MARKET_ID, REASON_HASH);
        assertEq(controller.marketStatus(MARKET_ID), 1);
        assertEq(registry.lastMarketId(), MARKET_ID);
        assertEq(registry.lastReasonHash(), REASON_HASH);
    }

    function test_unpauseRequiresExact24HourAccessManagerDelay() public {
        vm.prank(GUARDIAN);
        controller.pauseMarket(MARKET_ID, REASON_HASH);
        bytes memory data = abi.encodeCall(IMarketController.unpauseMarket, (MARKET_ID));

        vm.prank(UNPAUSER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector,
                UNPAUSER,
                IMarketController.unpauseMarket.selector
            )
        );
        controller.unpauseMarket(MARKET_ID);

        uint48 readyAt = uint48(block.timestamp + UNPAUSE_DELAY);
        vm.prank(UNPAUSER);
        manager.schedule(address(controller), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(UNPAUSER);
        vm.expectRevert();
        manager.execute(address(controller), data);

        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(controller));
        emit MarketStatusChanged(MARKET_ID, 1, 0, bytes32(0));
        vm.prank(UNPAUSER);
        manager.execute(address(controller), data);
        assertEq(controller.marketStatus(MARKET_ID), 0);
    }

    function test_retireRequiresExact48HourDelayFromActiveAndPaused() public {
        _scheduleAndExecuteRetire();
        assertEq(controller.marketStatus(MARKET_ID), 2);

        registry.setRuntime(2, 0);
        vm.prank(GUARDIAN);
        controller.pauseMarket(MARKET_ID, REASON_HASH);
        _scheduleAndExecuteRetire();
        assertEq(controller.marketStatus(MARKET_ID), 2);
    }

    function test_invalidTransitionsRevertWithoutControllerState() public {
        vm.prank(GUARDIAN);
        controller.pauseMarket(MARKET_ID, REASON_HASH);
        vm.prank(GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(ControllerRegistryMock.InvalidTransition.selector, 1, 1));
        controller.pauseMarket(MARKET_ID, REASON_HASH);
        assertEq(controller.marketStatus(MARKET_ID), 1);
    }

    function test_viewsAndAllocationGateUseOnlyPhaseMarketAndAssetStatus() public {
        assertEq(controller.launchPhase(MARKET_ID), 2);
        assertEq(controller.marketStatus(MARKET_ID), 0);
        assertTrue(controller.isStockAllocationOpen(MARKET_ID));

        stockRegistry.setStatus(ASSET_UID, 2);
        assertFalse(controller.isStockAllocationOpen(MARKET_ID));
        stockRegistry.setStatus(ASSET_UID, 1);
        registry.setRuntime(1, 0);
        assertFalse(controller.isStockAllocationOpen(MARKET_ID));
        registry.setRuntime(2, 1);
        assertFalse(controller.isStockAllocationOpen(MARKET_ID));
        registry.setRuntime(2, 0);
        assertTrue(controller.isStockAllocationOpen(MARKET_ID));
    }

    function test_allMutationsRequireTheirConfiguredSelectorRole() public {
        _expectUnauthorized(IMarketController.pauseMarket.selector);
        controller.pauseMarket(MARKET_ID, REASON_HASH);
        _expectUnauthorized(IMarketController.unpauseMarket.selector);
        controller.unpauseMarket(MARKET_ID);
        _expectUnauthorized(IMarketController.retireMarket.selector);
        controller.retireMarket(MARKET_ID, REASON_HASH);
        _expectUnauthorized(IMarketController.activateEmergencyExit.selector);
        controller.activateEmergencyExit(MARKET_ID);
    }

    function test_constructorRejectsMissingCodeAndAliasedDependencies() public {
        vm.expectRevert(abi.encodeWithSelector(MarketController.InvalidControllerDependency.selector, address(0)));
        _deploy(address(manager), address(0), address(stockRegistry), address(feeVault));

        address noCode = address(0x1234);
        vm.expectRevert(abi.encodeWithSelector(MarketController.InvalidControllerDependency.selector, noCode));
        _deploy(address(manager), noCode, address(stockRegistry), address(feeVault));

        vm.expectRevert(
            abi.encodeWithSelector(MarketController.AliasedControllerDependency.selector, address(registry))
        );
        _deploy(address(manager), address(registry), address(registry), address(feeVault));
    }

    function test_selectorsMatchCanonicalInterface() public pure {
        assertEq(MarketController.pauseMarket.selector, IMarketController.pauseMarket.selector);
        assertEq(MarketController.unpauseMarket.selector, IMarketController.unpauseMarket.selector);
        assertEq(MarketController.retireMarket.selector, IMarketController.retireMarket.selector);
        assertEq(MarketController.activateEmergencyExit.selector, IMarketController.activateEmergencyExit.selector);
        assertEq(MarketController.marketStatus.selector, IMarketController.marketStatus.selector);
        assertEq(MarketController.launchPhase.selector, IMarketController.launchPhase.selector);
        assertEq(MarketController.isStockAllocationOpen.selector, IMarketController.isStockAllocationOpen.selector);
    }

    function _scheduleAndExecuteRetire() private {
        uint8 oldStatus = controller.marketStatus(MARKET_ID);
        bytes memory data = abi.encodeCall(IMarketController.retireMarket, (MARKET_ID, REASON_HASH));
        vm.prank(ADMIN);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector,
                ADMIN,
                IMarketController.retireMarket.selector
            )
        );
        controller.retireMarket(MARKET_ID, REASON_HASH);

        uint48 readyAt = uint48(block.timestamp + RETIRE_DELAY);
        vm.prank(ADMIN);
        manager.schedule(address(controller), data, readyAt);
        vm.warp(readyAt - 1);
        vm.prank(ADMIN);
        vm.expectRevert();
        manager.execute(address(controller), data);
        vm.warp(readyAt);
        vm.expectEmit(true, false, false, true, address(controller));
        emit MarketStatusChanged(MARKET_ID, oldStatus, 2, REASON_HASH);
        vm.prank(ADMIN);
        manager.execute(address(controller), data);
        assertEq(registry.lastMarketId(), MARKET_ID);
        assertEq(registry.lastReasonHash(), REASON_HASH);
    }

    function _deploy(address authority, address marketRegistry, address assets, address vault)
        private
        returns (MarketController)
    {
        return new MarketController(
            MarketControllerInit({
                authority: authority,
                marketRegistry: marketRegistry,
                officialStockRegistry: assets,
                protocolFeeVault: vault
            })
        );
    }

    function _setRole(bytes4 selector, uint64 role) private {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = selector;
        manager.setTargetFunctionRole(address(controller), selectors, role);
    }

    function _expectUnauthorized(bytes4 selector) private {
        vm.expectRevert(
            abi.encodeWithSelector(ImmutableAccessManaged.AccessManagedUnauthorized.selector, address(this), selector)
        );
    }
}
