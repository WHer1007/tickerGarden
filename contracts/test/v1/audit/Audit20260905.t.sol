// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {
    OfficialStockRegistryV1InspectionHarness,
    MockUserStockVaultIdentity,
    EmptyV1Contract
} from "../product/OfficialStockRegistryV1.t.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {
    InvariantOfficialStockRegistry,
    InvariantMarketRegistry,
    InvariantFeeVault
} from "../product/VaultGaugeInvariant.t.sol";
import {StockTokenFingerprint, GaugeIdentity, PonsBaseline} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {PonsBaselineRegistry} from "../../../src/v1/modules/PonsBaselineRegistry.sol";
import {AllocationManager} from "../../../src/v1/modules/AllocationManager.sol";
import {UserStockVault} from "../../../src/v1/modules/UserStockVault.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {MemeStockGaugeClone} from "../../../src/v1/shared/MemeStockGaugeClone.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

contract AuditDelegateTarget {
    uint256 public immutable version;

    constructor(uint256 version_) {
        version = version_;
    }

    function uid() external pure returns (bytes32) {
        return keccak256("audit-asset");
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function upgrade(address next) external {
        assembly { sstore(0, next) }
    }

    function writeMarker() external {
        assembly { sstore(1, 42) }
    }
}

/// @notice Regression tests for the 2026-09-05 audit findings.
contract Audit20260905ScannerTest is Test {
    function test_audit_pushImmediateCannotHideExecutableDelegatecall() public {
        AccessManager authority = new AccessManager(address(this));
        OfficialStockRegistryV1InspectionHarness scanner =
            new OfficialStockRegistryV1InspectionHarness(address(authority));
        AuditDelegateTarget implementation = new AuditDelegateTarget(1);
        address proxy = address(0xCA09);
        // PUSH1 FE; POP; calldata copy; DELEGATECALL using SLOAD(0); return data.
        // a0 0001 is fake metadata. The only FE is PUSH immediate data, not INVALID.
        vm.etch(proxy, hex"60fe50365f5f375f5f365f5f545af43d5f5f3e3d5ff3a00001");
        vm.store(proxy, bytes32(0), bytes32(uint256(uint160(address(implementation)))));
        assertTrue(scanner.containsDelegateExecution(proxy), "scanner missed executable delegate runtime");
        (bool success,) = proxy.call(abi.encodeCall(AuditDelegateTarget.writeMarker, ()));
        assertTrue(success);
        assertEq(uint256(vm.load(proxy, bytes32(uint256(1)))), 42, "DELEGATECALL executed in proxy storage");

        address marketRegistry = address(new EmptyV1Contract());
        address allocation = address(new EmptyV1Contract());
        address vault = address(
            new MockUserStockVaultIdentity(address(scanner), marketRegistry, allocation, keccak256("audit-schema"))
        );
        StockTokenFingerprint memory fingerprint = StockTokenFingerprint({
            tokenRuntimeCodeHash: proxy.codehash,
            beacon: address(0),
            beaconRuntimeCodeHash: bytes32(0),
            implementation: proxy,
            implementationRuntimeCodeHash: proxy.codehash
        });
        vm.expectRevert(abi.encodeWithSelector(OfficialStockRegistryV1.UnmonitoredDelegateProxy.selector, proxy));
        scanner.registerAsset(keccak256("audit-asset"), proxy, 18, vault, 414, fingerprint);
    }
}

contract Audit20260905AdmissionTest is Test {
    function test_audit_baselineRejectsFeeAboveCurveLimit() public {
        PonsBaselineRegistry registry = new PonsBaselineRegistry(address(new AccessManager(address(this))));
        address referenceFactory = address(new EmptyV1Contract());
        PonsBaseline memory baseline = PonsBaseline({
            referenceChainId: block.chainid,
            referenceFactory: referenceFactory,
            referenceFactoryCodeHash: referenceFactory.codehash,
            launchConfigId: 0,
            supply: 1_000_000_000 ether,
            curveFeeBps: 9901,
            poolFee: 0,
            tickSpacing: 200,
            behaviorVectorRoot: keccak256("audit-behavior"),
            status: 1
        });
        bytes32 id = keccak256("audit-baseline");
        vm.expectRevert(abi.encodeWithSelector(PonsBaselineRegistry.InvalidPonsBaseline.selector, id));
        registry.addBaseline(id, baseline);
    }
}

contract Audit20260905RewardsTest is Test {
    bytes32 constant ASSET_UID = keccak256("audit-stock");
    bytes32 constant MARKET_A = keccak256("audit-market");
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    MockExactQuoteToken stock;
    MockExactQuoteToken quote;
    UserStockVault vault;
    AllocationManager manager;
    MemeStockGauge gaugeA;
    InvariantFeeVault feeVault;

    function setUp() public {
        vm.warp(1_000_000);
        InvariantOfficialStockRegistry registry = new InvariantOfficialStockRegistry();
        InvariantMarketRegistry markets = new InvariantMarketRegistry();
        feeVault = new InvariantFeeVault();
        stock = new MockExactQuoteToken(18);
        quote = new MockExactQuoteToken(6);
        MockExactQuoteToken meme = new MockExactQuoteToken(18);
        manager = new AllocationManager(address(registry), address(markets));
        vault = new UserStockVault(address(registry), address(markets), address(manager));
        gaugeA = MemeStockGauge(
            MemeStockGaugeClone.deployDeterministic(
                address(new MemeStockGauge()),
                keccak256("audit-gauge"),
                GaugeIdentity({
                    marketId: MARKET_A,
                    assetUid: ASSET_UID,
                    quoteAssetConfigId: keccak256("audit-quote"),
                    allocationManager: address(manager),
                    protocolFeeVault: address(feeVault),
                    quoteAsset: address(quote),
                    memeToken: address(meme)
                })
            )
        );
        registry.configure(ASSET_UID, address(stock), address(vault), 18, 1, 414);
        markets.configure(MARKET_A, ASSET_UID, address(gaugeA));
    }

    function test_audit_deferredLastExitReservesIndexRemainderBeforeNewCohort() public {
        // Large but uncapped admitted STOCK amount makes the carry visible in whole Quote units.
        _auditStake(ALICE, 1000 * 1e27);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 999, keccak256("audit-old-fee"));
        assertEq(gaugeA.rewardState(address(quote)).accFeePerShare, 0);
        assertEq(gaugeA.rewardState(address(quote)).indexRemainder, 999 * 1e27);

        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_A);
        assertEq(gaugeA.effectiveTotalActiveStock(), 0);
        _auditStake(BOB, 1 ether);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 1, keccak256("audit-new-fee"));
        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 1);
        manager.settleRageQuitRewards(MARKET_A, ALICE);
        assertEq(feeVault.recordedQuoteForfeiture(), 999);
        vm.warp(gaugeA.positionOf(BOB).unlockAt);
        vm.prank(address(feeVault));
        assertEq(gaugeA.consumeClaimable(BOB, address(quote)), 1);
    }

    function _auditStake(address user, uint256 amount) private {
        stock.mint(user, amount);
        vm.startPrank(user);
        stock.approve(address(vault), amount);
        manager.stake(MARKET_A, amount);
        vm.stopPrank();
    }

    function test_audit_controlCleanupBeforeNewCohortReservesOldRemainder() public {
        _auditStake(ALICE, 1000 * 1e27);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 999, keccak256("audit-old-fee"));
        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_A);
        manager.settleRageQuitRewards(MARKET_A, ALICE);
        assertEq(feeVault.recordedQuoteForfeiture(), 999);
        _auditStake(BOB, 1 ether);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 1, keccak256("audit-new-fee"));
        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 1);
    }
}
