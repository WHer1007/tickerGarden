// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {MarketConfig, MarketRuntime, MarketView, RecoveryRootView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {ImmutableAccessManaged} from "../../../src/v2/shared/ImmutableAccessManaged.sol";
import {ProtocolFeeVaultRecoveryRoots} from "../../../src/v2/shared/ProtocolFeeVaultRecoveryRoots.sol";
import {ProtocolFeeVaultV4Credit} from "../../../src/v2/shared/ProtocolFeeVaultV4Credit.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract RootsRegistryMock {
    mapping(bytes32 => MarketView) private markets;

    function configure(
        bytes32 id,
        address quote,
        address meme,
        address gauge,
        address controller,
        uint32 epoch,
        uint8 status
    ) external {
        MarketConfig memory config;
        config.quoteAsset = quote;
        config.memeToken = meme;
        config.gauge = gauge;
        config.marketController = controller;
        MarketRuntime memory runtime;
        runtime.recoveryEpoch = epoch;
        runtime.marketStatus = status;
        markets[id] = MarketView({config: config, runtime: runtime});
    }

    function market(bytes32 id) external view returns (MarketView memory) {
        return markets[id];
    }
}

contract RootsDependencyMock {}

contract ProtocolFeeVaultRecoveryRootsHarness is ProtocolFeeVaultRecoveryRoots {
    constructor(
        address authority,
        address registry,
        address pool,
        address creator,
        address treasury,
        bytes32 policy,
        address controller
    ) ProtocolFeeVaultRecoveryRoots(authority, registry, pool, creator, treasury, policy, controller) {}

    function creditStakerLiability(bytes32 marketId, address asset, uint256 amount) external {
        _creditFeeLiabilities(marketId, 1, asset, amount, 0, amount, 0);
    }
}

contract ProtocolFeeVaultRecoveryRootsTest is Test {
    event RecoveryRootProposed(
        bytes32 indexed marketId,
        uint32 indexed recoveryEpoch,
        address indexed feeAsset,
        uint32 proposalNonce,
        bytes32 root,
        uint256 declaredTotal,
        uint64 finalizableAt
    );
    event RecoveryRootCancelled(
        bytes32 indexed marketId, uint32 indexed recoveryEpoch, address indexed feeAsset, uint32 proposalNonce
    );
    event RecoveryRootFinalized(
        bytes32 indexed marketId,
        uint32 indexed recoveryEpoch,
        address indexed feeAsset,
        uint32 proposalNonce,
        bytes32 root,
        uint256 declaredTotal
    );

    uint64 private constant PROPOSE_ROLE = 10;
    uint64 private constant CANCEL_ROLE = 11;
    uint32 private constant EPOCH = 1;
    uint32 private constant DAY = 1 days;
    uint32 private constant CHALLENGE = 2 days;
    uint8 private constant EMERGENCY = 3;
    bytes32 private constant MARKET = keccak256("roots-market");
    bytes32 private constant ROOT = keccak256("root");
    bytes32 private constant POLICY = keccak256("policy");
    address private constant CONTROLLER = address(0xC011);
    address private constant PROPOSER = address(0xBEEF);
    address private constant GUARDIAN = address(0x6A7D);
    address private constant OTHER = address(0xBAD);

    AccessManager private manager;
    RootsRegistryMock private registry;
    ProtocolFeeVaultRecoveryRootsHarness private vault;
    MockExactQuoteToken private quote;
    MockExactQuoteToken private meme;
    MockExactQuoteToken private third;
    RootsDependencyMock private pool;
    RootsDependencyMock private creator;
    RootsDependencyMock private treasury;
    RootsDependencyMock private gauge;

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(100);
        manager = new AccessManager(address(this));
        registry = new RootsRegistryMock();
        quote = new MockExactQuoteToken(6);
        meme = new MockExactQuoteToken(18);
        third = new MockExactQuoteToken(8);
        pool = new RootsDependencyMock();
        creator = new RootsDependencyMock();
        treasury = new RootsDependencyMock();
        gauge = new RootsDependencyMock();
        vault = new ProtocolFeeVaultRecoveryRootsHarness(
            address(manager), address(registry), address(pool), address(creator), address(treasury), POLICY, CONTROLLER
        );
        registry.configure(MARKET, address(quote), address(meme), address(gauge), CONTROLLER, 0, 1);
        quote.mint(address(vault), 20);
        meme.mint(address(vault), 30);
        vault.creditStakerLiability(MARKET, address(quote), 20);
        vault.creditStakerLiability(MARKET, address(meme), 30);
        _setRole(ProtocolFeeVaultRecoveryRoots.proposeRecoveryRoot.selector, PROPOSE_ROLE);
        _setRole(ProtocolFeeVaultRecoveryRoots.cancelRecoveryRoot.selector, CANCEL_ROLE);
        manager.grantRole(PROPOSE_ROLE, PROPOSER, DAY);
        manager.grantRole(CANCEL_ROLE, GUARDIAN, 0);
    }

    function _setRole(bytes4 selector, uint64 role) private {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = selector;
        manager.setTargetFunctionRole(address(vault), selectors, role);
    }

    function _freezeAndEnterEmergency() private {
        uint64 snapshotBlock = uint64(block.number - 1);
        vm.prank(CONTROLLER);
        vault.freezeRecoveryCaps(MARKET, EPOCH, snapshotBlock, keccak256("snapshot"));
        registry.configure(MARKET, address(quote), address(meme), address(gauge), CONTROLLER, EPOCH, EMERGENCY);
    }

    function _scheduleProposal(bytes32 root, uint256 total, uint48 readyAt) private returns (bytes memory data) {
        data = abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(quote), root, total));
        vm.prank(PROPOSER);
        manager.schedule(address(vault), data, readyAt);
    }

    function test_proposeRequiresEmergencyExactEpochAndFrozenSnapshot() public {
        bytes memory data = abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(quote), ROOT, 10));
        vm.prank(PROPOSER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector, PROPOSER, vault.proposeRecoveryRoot.selector
            )
        );
        vault.proposeRecoveryRoot(MARKET, EPOCH, address(quote), ROOT, 10);

        _freezeAndEnterEmergency();
        uint48 readyAt = uint48(block.timestamp + DAY);
        _scheduleProposal(ROOT, 10, readyAt);
        vm.warp(readyAt);
        vm.prank(PROPOSER);
        manager.execute(address(vault), data);
        RecoveryRootView memory value = vault.recoveryRoot(MARKET, EPOCH, address(quote));
        assertEq(value.status, 1);
        assertEq(value.proposalNonce, 1);
        assertEq(value.declaredTotal, 10);
        assertEq(value.finalizableAt, block.timestamp + CHALLENGE);
    }

    function test_proposeRejectsNonEmergencyWrongEpochAndMissingSnapshot() public {
        bytes memory data = abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(quote), ROOT, 10));
        uint48 readyAt = uint48(block.timestamp + DAY);
        _scheduleProposal(ROOT, 10, readyAt);
        vm.warp(readyAt);
        vm.prank(PROPOSER);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultRecoveryRoots.InvalidRecoveryRoot.selector, bytes32(0), uint256(0))
        );
        manager.execute(address(vault), data);

        _freezeAndEnterEmergency();
        bytes memory wrongEpoch = abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, 2, address(quote), ROOT, 10));
        vm.prank(PROPOSER);
        manager.schedule(address(vault), wrongEpoch, uint48(block.timestamp + DAY));
        vm.warp(block.timestamp + DAY);
        vm.prank(PROPOSER);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultRecoveryRoots.InvalidRecoveryRoot.selector, bytes32(0), uint256(0))
        );
        manager.execute(address(vault), wrongEpoch);
    }

    function test_proposeRejectsInvalidRootTotalCapAndNonCanonicalAsset() public {
        _freezeAndEnterEmergency();
        vm.prank(PROPOSER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector, PROPOSER, vault.proposeRecoveryRoot.selector
            )
        );
        vault.proposeRecoveryRoot(MARKET, EPOCH, address(quote), ROOT, 10);
        uint48 readyAt = uint48(block.timestamp + DAY);
        bytes memory zero = _scheduleProposal(bytes32(0), 10, readyAt);
        vm.warp(readyAt);
        vm.prank(PROPOSER);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultRecoveryRoots.InvalidRecoveryRoot.selector, bytes32(0), uint256(10))
        );
        manager.execute(address(vault), zero);

        bytes memory zeroTotal = abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(quote), ROOT, 0));
        vm.prank(PROPOSER);
        manager.schedule(address(vault), zeroTotal, uint48(block.timestamp + DAY));
        vm.warp(block.timestamp + DAY);
        vm.prank(PROPOSER);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultRecoveryRoots.InvalidRecoveryRoot.selector, ROOT, uint256(0))
        );
        manager.execute(address(vault), zeroTotal);

        bytes memory tooMuch = abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(quote), ROOT, 21));
        uint48 tooMuchReady = uint48(block.timestamp + DAY);
        vm.prank(PROPOSER);
        manager.schedule(address(vault), tooMuch, tooMuchReady);
        vm.warp(tooMuchReady);
        vm.prank(PROPOSER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryRoots.RecoveryCapExceeded.selector, address(quote), uint256(21), uint256(20)
            )
        );
        manager.execute(address(vault), tooMuch);

        bytes memory nonCanonical = abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(third), ROOT, 1));
        vm.prank(PROPOSER);
        manager.schedule(address(vault), nonCanonical, uint48(block.timestamp + DAY));
        vm.warp(block.timestamp + DAY);
        vm.prank(PROPOSER);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultV4Credit.FeeAssetNotCanonical.selector, address(third)));
        manager.execute(address(vault), nonCanonical);
    }

    function test_cancelIsImmediateGuardianOnlyAndTerminal() public {
        _freezeAndEnterEmergency();
        uint48 readyAt = uint48(block.timestamp + DAY);
        bytes memory data = _scheduleProposal(ROOT, 10, readyAt);
        vm.warp(readyAt);
        vm.prank(PROPOSER);
        manager.execute(address(vault), data);
        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ImmutableAccessManaged.AccessManagedUnauthorized.selector, OTHER, vault.cancelRecoveryRoot.selector
            )
        );
        vault.cancelRecoveryRoot(MARKET, EPOCH, address(quote), 1);
        vm.expectEmit(true, true, true, true, address(vault));
        emit RecoveryRootCancelled(MARKET, EPOCH, address(quote), 1);
        vm.prank(GUARDIAN);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryRoots.InvalidRecoveryProposalNonce.selector, uint32(2), uint32(1)
            )
        );
        vault.cancelRecoveryRoot(MARKET, EPOCH, address(quote), 2);
        vm.prank(GUARDIAN);
        vault.cancelRecoveryRoot(MARKET, EPOCH, address(quote), 1);
        assertEq(vault.recoveryRoot(MARKET, EPOCH, address(quote)).status, 3);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultRecoveryRoots.InvalidRecoveryRootState.selector, uint8(3), uint8(1))
        );
        vault.finalizeRecoveryRoot(MARKET, EPOCH, address(quote), 1);
    }

    function test_finalizeAtExact48HoursAndWrongNonceRejected() public {
        _freezeAndEnterEmergency();
        uint48 readyAt = uint48(block.timestamp + DAY);
        bytes memory data = _scheduleProposal(ROOT, 10, readyAt);
        vm.warp(readyAt);
        vm.prank(PROPOSER);
        manager.execute(address(vault), data);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryRoots.InvalidRecoveryProposalNonce.selector, uint32(2), uint32(1)
            )
        );
        vault.finalizeRecoveryRoot(MARKET, EPOCH, address(quote), 2);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryRoots.RecoveryRootNotFinalizable.selector, uint64(block.timestamp + CHALLENGE)
            )
        );
        vault.finalizeRecoveryRoot(MARKET, EPOCH, address(quote), 1);
        vm.warp(block.timestamp + CHALLENGE);
        vm.expectEmit(true, true, true, true, address(vault));
        emit RecoveryRootFinalized(MARKET, EPOCH, address(quote), 1, ROOT, 10);
        vault.finalizeRecoveryRoot(MARKET, EPOCH, address(quote), 1);
        assertEq(vault.recoveryRoot(MARKET, EPOCH, address(quote)).status, 2);
    }

    function test_cancelledRootCanBeReproposedWithIncrementedNonce() public {
        _freezeAndEnterEmergency();
        uint48 readyAt = uint48(block.timestamp + DAY);
        bytes memory first = _scheduleProposal(ROOT, 10, readyAt);
        vm.warp(readyAt);
        vm.prank(PROPOSER);
        manager.execute(address(vault), first);
        vm.prank(GUARDIAN);
        vault.cancelRecoveryRoot(MARKET, EPOCH, address(quote), 1);
        bytes memory second =
            abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(quote), keccak256("root-2"), 20));
        uint48 secondReady = uint48(block.timestamp + DAY);
        vm.prank(PROPOSER);
        manager.schedule(address(vault), second, secondReady);
        vm.warp(secondReady);
        vm.prank(PROPOSER);
        manager.execute(address(vault), second);
        assertEq(vault.recoveryRoot(MARKET, EPOCH, address(quote)).proposalNonce, 2);
    }
}
