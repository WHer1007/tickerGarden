// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";
import {MarketConfig, MarketRuntime, MarketView, RecoveryRootView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {ProtocolFeeVaultRecoveryClaims} from "../../../src/v2/shared/ProtocolFeeVaultRecoveryClaims.sol";
import {ProtocolFeeVaultRecoveryRoots} from "../../../src/v2/shared/ProtocolFeeVaultRecoveryRoots.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract ClaimsRegistryMock {
    mapping(bytes32 => MarketView) private _markets;

    function configure(
        bytes32 id,
        address quote,
        address meme,
        address gauge,
        address controller,
        uint32 epoch,
        uint8 status
    ) external {
        MarketConfig memory c;
        c.quoteAsset = quote;
        c.memeToken = meme;
        c.gauge = gauge;
        c.marketController = controller;
        MarketRuntime memory r;
        r.recoveryEpoch = epoch;
        r.marketStatus = status;
        _markets[id] = MarketView({config: c, runtime: r});
    }

    function market(bytes32 id) external view returns (MarketView memory) {
        return _markets[id];
    }
}

contract ClaimsDependencyMock {}

contract ClaimsToggleToken is MockExactQuoteToken {
    bool public fail;
    constructor() MockExactQuoteToken(18) {}

    function setFail(bool value) external {
        fail = value;
    }

    function transfer(address recipient, uint256 amount) external override returns (bool) {
        if (fail) revert("FAIL");
        _transfer(msg.sender, recipient, amount);
        return true;
    }
}

contract ProtocolFeeVaultRecoveryClaimsHarness is ProtocolFeeVaultRecoveryClaims {
    constructor(address a, address r, address p, address c, address t, bytes32 policy, address controller)
        ProtocolFeeVaultRecoveryClaims(a, r, p, c, t, policy, controller)
    {}

    function credit(bytes32 market, address asset, uint256 amount) external {
        _creditFeeLiabilities(market, 1, asset, amount, 0, amount, 0);
    }
}

contract ProtocolFeeVaultRecoveryClaimsTest is Test {
    bytes32 private constant MARKET = keccak256("claims-market");
    bytes32 private constant OTHER_MARKET = keccak256("other-market");
    bytes32 private constant POLICY = keccak256("policy");
    address private constant CONTROLLER = address(0xC011);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant PROPOSER = address(0xBEEF);
    address private constant GUARDIAN = address(0x6A7D);
    uint8 private constant EMERGENCY = 3;
    uint8 private constant PAUSED = 1;
    uint64 private constant ROLE = 10;
    uint64 private constant CANCEL_ROLE = 11;
    AccessManager private manager;
    ClaimsRegistryMock private registry;
    ProtocolFeeVaultRecoveryClaimsHarness private vault;
    MockExactQuoteToken private quote;
    MockExactQuoteToken private meme;
    ClaimsToggleToken private failing;
    ClaimsDependencyMock private pool;
    ClaimsDependencyMock private creator;
    ClaimsDependencyMock private treasury;
    ClaimsDependencyMock private gauge;
    uint32 private constant EPOCH = 1;

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(100);
        manager = new AccessManager(address(this));
        registry = new ClaimsRegistryMock();
        quote = new MockExactQuoteToken(6);
        meme = new MockExactQuoteToken(18);
        failing = new ClaimsToggleToken();
        pool = new ClaimsDependencyMock();
        creator = new ClaimsDependencyMock();
        treasury = new ClaimsDependencyMock();
        gauge = new ClaimsDependencyMock();
        vault = new ProtocolFeeVaultRecoveryClaimsHarness(
            address(manager), address(registry), address(pool), address(creator), address(treasury), POLICY, CONTROLLER
        );
        registry.configure(MARKET, address(quote), address(meme), address(gauge), CONTROLLER, 0, PAUSED);
        quote.mint(address(vault), 20);
        meme.mint(address(vault), 30);
        failing.mint(address(vault), 10);
        vault.credit(MARKET, address(quote), 20);
        vault.credit(MARKET, address(meme), 30);
        _setUpRole();
        _freezeAndEnter(MARKET, address(quote));
    }

    function _setUpRole() private {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = vault.proposeRecoveryRoot.selector;
        manager.setTargetFunctionRole(address(vault), selectors, ROLE);
        selectors[0] = vault.cancelRecoveryRoot.selector;
        manager.setTargetFunctionRole(address(vault), selectors, CANCEL_ROLE);
        manager.grantRole(ROLE, PROPOSER, 1);
        manager.grantRole(CANCEL_ROLE, GUARDIAN, 0);
    }

    function _freezeAndEnter(bytes32 id, address asset) private {
        vm.prank(CONTROLLER);
        vault.freezeRecoveryCaps(id, EPOCH, uint64(block.number - 1), keccak256("state"));
        registry.configure(id, asset, address(meme), address(gauge), CONTROLLER, EPOCH, EMERGENCY);
    }

    function _leaf(bytes32 id, uint32 epoch, address asset, address user, uint256 amount)
        private
        view
        returns (bytes32)
    {
        bytes32 inner = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V2_RECOVERY_LEAF_V1"),
                uint256(1),
                block.chainid,
                address(vault),
                keccak256("V2-EXEC-4"),
                id,
                epoch,
                asset,
                user,
                amount
            )
        );
        return keccak256(bytes.concat(inner));
    }

    function _root(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(bytes.concat(a, b)) : keccak256(bytes.concat(b, a));
    }

    function _activate(address asset, bytes32 root, uint256 total) private {
        _activateFor(MARKET, EPOCH, asset, root, total);
    }

    function _activateFor(bytes32 marketId, uint32 epoch, address asset, bytes32 root, uint256 total) private {
        bytes memory data = abi.encodeCall(vault.proposeRecoveryRoot, (marketId, epoch, asset, root, total));
        vm.prank(PROPOSER);
        manager.schedule(address(vault), data, uint48(block.timestamp + 1));
        vm.warp(block.timestamp + 1);
        vm.prank(PROPOSER);
        manager.execute(address(vault), data);
        vm.warp(block.timestamp + 2 days);
        vault.finalizeRecoveryRoot(marketId, epoch, asset, 1);
    }

    function test_twoLeafMerkleClaimsAreCallerBoundAndDebitExactLiability() public {
        bytes32 aliceLeaf = _leaf(MARKET, EPOCH, address(quote), ALICE, 7);
        bytes32 bobLeaf = _leaf(MARKET, EPOCH, address(quote), BOB, 13);
        _activate(address(quote), _root(aliceLeaf, bobLeaf), 20);
        vm.prank(ALICE);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 7, _proof(bobLeaf));
        vm.prank(BOB);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 13, _proof(aliceLeaf));
        assertEq(quote.balanceOf(ALICE), 7);
        assertEq(quote.balanceOf(BOB), 13);
        assertEq(vault.liability(MARKET, address(quote), 1), 0);
        assertEq(vault.totalLiability(address(quote)), 0);
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryClaims.RecoveryAlreadyClaimed.selector, ALICE, address(quote)
            )
        );
        vault.claimRecovery(MARKET, EPOCH, address(quote), 7, _proof(bobLeaf));
    }

    function _proof(bytes32 sibling) private pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    function test_rejectsCallerAndDomainParametersAndZeroAmount() public {
        bytes32 a = _leaf(MARKET, EPOCH, address(quote), ALICE, 7);
        bytes32 b = _leaf(MARKET, EPOCH, address(quote), BOB, 13);
        _activate(address(quote), _root(a, b), 20);
        vm.prank(ALICE);
        vm.expectRevert(ProtocolFeeVaultRecoveryClaims.InvalidRecoveryProof.selector);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 8, _proof(b));
        vm.prank(address(0x123));
        vm.expectRevert(ProtocolFeeVaultRecoveryClaims.InvalidRecoveryProof.selector);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 7, _proof(b));
        vm.prank(ALICE);
        vm.expectRevert(ProtocolFeeVaultRecoveryClaims.InvalidRecoveryProof.selector);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 0, _proof(b));
        vm.prank(ALICE);
        vm.expectRevert(ProtocolFeeVaultRecoveryClaims.InvalidRecoveryProof.selector);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 7, _proof(a));
    }

    function test_crossMarketEpochAssetAndChainDomainsCannotReuseAValidLeaf() public {
        bytes32 quoteLeaf = _leaf(MARKET, EPOCH, address(quote), ALICE, 7);
        _activate(address(quote), quoteLeaf, 7);

        vm.prank(ALICE);
        vm.expectRevert();
        vault.claimRecovery(MARKET, EPOCH + 1, address(quote), 7, new bytes32[](0));

        uint256 originalChainId = block.chainid;
        vm.chainId(originalChainId + 1);
        vm.prank(ALICE);
        vm.expectRevert(ProtocolFeeVaultRecoveryClaims.InvalidRecoveryProof.selector);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 7, new bytes32[](0));
        vm.chainId(originalChainId);

        _activate(address(meme), quoteLeaf, 7);
        vm.prank(ALICE);
        vm.expectRevert(ProtocolFeeVaultRecoveryClaims.InvalidRecoveryProof.selector);
        vault.claimRecovery(MARKET, EPOCH, address(meme), 7, new bytes32[](0));

        registry.configure(OTHER_MARKET, address(quote), address(meme), address(gauge), CONTROLLER, 0, PAUSED);
        quote.mint(address(vault), 20);
        vault.credit(OTHER_MARKET, address(quote), 20);
        _freezeAndEnter(OTHER_MARKET, address(quote));
        _activateFor(OTHER_MARKET, EPOCH, address(quote), quoteLeaf, 7);
        vm.prank(ALICE);
        vm.expectRevert(ProtocolFeeVaultRecoveryClaims.InvalidRecoveryProof.selector);
        vault.claimRecovery(OTHER_MARKET, EPOCH, address(quote), 7, new bytes32[](0));

        assertEq(vault.liability(MARKET, address(quote), 1), 20);
        assertEq(vault.liability(MARKET, address(meme), 1), 30);
        assertEq(vault.liability(OTHER_MARKET, address(quote), 1), 20);
    }

    function test_pendingCancelledNonEmergencyAndWrongEpochRejected() public {
        bytes32 a = _leaf(MARKET, EPOCH, address(quote), ALICE, 7);
        bytes memory data = abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(quote), a, 7));
        vm.prank(PROPOSER);
        manager.schedule(address(vault), data, uint48(block.timestamp + 1));
        vm.warp(block.timestamp + 1);
        vm.prank(PROPOSER);
        manager.execute(address(vault), data);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultRecoveryRoots.InvalidRecoveryRootState.selector, 1, 2));
        vault.claimRecovery(MARKET, EPOCH, address(quote), 7, new bytes32[](0));
        vm.prank(GUARDIAN);
        vault.cancelRecoveryRoot(MARKET, EPOCH, address(quote), 1);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFeeVaultRecoveryRoots.InvalidRecoveryRootState.selector, 3, 2));
        vault.claimRecovery(MARKET, EPOCH, address(quote), 7, new bytes32[](0));
        registry.configure(MARKET, address(quote), address(meme), address(gauge), CONTROLLER, 0, PAUSED);
        vm.prank(ALICE);
        vm.expectRevert();
        vault.claimRecovery(MARKET, EPOCH, address(quote), 7, new bytes32[](0));
    }

    function test_declaredTotalAndCapBoundClaims() public {
        bytes32 a = _leaf(MARKET, EPOCH, address(quote), ALICE, 15);
        bytes32 b = _leaf(MARKET, EPOCH, address(quote), BOB, 6);
        _activate(address(quote), _root(a, b), 20);
        vm.prank(ALICE);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 15, _proof(b));
        vm.prank(BOB);
        vm.expectRevert();
        vault.claimRecovery(MARKET, EPOCH, address(quote), 6, _proof(a));
    }

    function test_transferFailureRollsBackClaimAndLiability() public {
        // Use a separately frozen canonical asset with an intentionally failing transfer.
        registry.configure(OTHER_MARKET, address(failing), address(meme), address(gauge), CONTROLLER, 0, PAUSED);
        failing.mint(address(vault), 10);
        vault.credit(OTHER_MARKET, address(failing), 10);
        vm.prank(CONTROLLER);
        vault.freezeRecoveryCaps(OTHER_MARKET, EPOCH, uint64(block.number - 1), keccak256("other"));
        registry.configure(OTHER_MARKET, address(failing), address(meme), address(gauge), CONTROLLER, EPOCH, EMERGENCY);
        bytes32 l = _leaf(OTHER_MARKET, EPOCH, address(failing), ALICE, 10);
        _activateOther(l);
        failing.setFail(true);
        vm.prank(ALICE);
        vm.expectRevert();
        vault.claimRecovery(OTHER_MARKET, EPOCH, address(failing), 10, new bytes32[](0));
        assertEq(vault.liability(OTHER_MARKET, address(failing), 1), 10);
        failing.setFail(false);
        vm.prank(ALICE);
        vault.claimRecovery(OTHER_MARKET, EPOCH, address(failing), 10, new bytes32[](0));
        assertEq(failing.balanceOf(ALICE), 10);
    }

    function test_cancelCorrectReproposeFinalizeClaimAndOldRootRemainTerminal() public {
        bytes32 wrongRoot = _leaf(MARKET, EPOCH, address(quote), ALICE, 20);
        bytes memory first = abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(quote), wrongRoot, 20));
        vm.prank(PROPOSER);
        manager.schedule(address(vault), first, uint48(block.timestamp + 1));
        vm.warp(block.timestamp + 1);
        vm.prank(PROPOSER);
        manager.execute(address(vault), first);
        vm.prank(GUARDIAN);
        vault.cancelRecoveryRoot(MARKET, EPOCH, address(quote), 1);

        bytes32 aliceLeaf = _leaf(MARKET, EPOCH, address(quote), ALICE, 7);
        bytes32 bobLeaf = _leaf(MARKET, EPOCH, address(quote), BOB, 13);
        bytes32 correctedRoot = _root(aliceLeaf, bobLeaf);
        bytes memory second =
            abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(quote), correctedRoot, 20));
        vm.prank(PROPOSER);
        manager.schedule(address(vault), second, uint48(block.timestamp + 1));
        vm.warp(block.timestamp + 1);
        vm.prank(PROPOSER);
        manager.execute(address(vault), second);

        RecoveryRootView memory pending = vault.recoveryRoot(MARKET, EPOCH, address(quote));
        assertEq(pending.proposalNonce, 2);
        assertEq(pending.status, 1);
        vm.warp(pending.finalizableAt);
        vault.finalizeRecoveryRoot(MARKET, EPOCH, address(quote), 2);

        vm.prank(ALICE);
        vm.expectRevert(ProtocolFeeVaultRecoveryClaims.InvalidRecoveryProof.selector);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 20, new bytes32[](0));
        vm.prank(ALICE);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 7, _proof(bobLeaf));
        RecoveryRootView memory afterAlice = vault.recoveryRoot(MARKET, EPOCH, address(quote));
        assertEq(afterAlice.claimedTotal + vault.liability(MARKET, address(quote), 1), 20);
        vm.prank(BOB);
        vault.claimRecovery(MARKET, EPOCH, address(quote), 13, _proof(aliceLeaf));
        RecoveryRootView memory complete = vault.recoveryRoot(MARKET, EPOCH, address(quote));
        assertEq(complete.claimedTotal, vault.recoveryCap(MARKET, EPOCH, address(quote)));
        assertEq(complete.claimedTotal + vault.liability(MARKET, address(quote), 1), 20);
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryClaims.RecoveryAlreadyClaimed.selector, ALICE, address(quote)
            )
        );
        vault.claimRecovery(MARKET, EPOCH, address(quote), 7, _proof(bobLeaf));

        bytes memory restore = abi.encodeCall(vault.proposeRecoveryRoot, (MARKET, EPOCH, address(quote), wrongRoot, 20));
        vm.prank(PROPOSER);
        manager.schedule(address(vault), restore, uint48(block.timestamp + 1));
        vm.warp(block.timestamp + 1);
        vm.prank(PROPOSER);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultRecoveryRoots.InvalidRecoveryRootState.selector, uint8(2), uint8(3))
        );
        manager.execute(address(vault), restore);
    }

    function testFuzz_claimedPlusRemainingLiabilityNeverExceedsFrozenCap(uint8 rawAlice, uint8 rawBob) public {
        uint256 aliceAmount = bound(rawAlice, 1, 19);
        uint256 bobAmount = bound(rawBob, 1, 20 - aliceAmount);
        bytes32 aliceLeaf = _leaf(MARKET, EPOCH, address(quote), ALICE, aliceAmount);
        bytes32 bobLeaf = _leaf(MARKET, EPOCH, address(quote), BOB, bobAmount);
        _activate(address(quote), _root(aliceLeaf, bobLeaf), aliceAmount + bobAmount);

        vm.prank(ALICE);
        vault.claimRecovery(MARKET, EPOCH, address(quote), aliceAmount, _proof(bobLeaf));
        RecoveryRootView memory afterAlice = vault.recoveryRoot(MARKET, EPOCH, address(quote));
        assertLe(afterAlice.claimedTotal + vault.liability(MARKET, address(quote), 1), 20);

        vm.prank(BOB);
        vault.claimRecovery(MARKET, EPOCH, address(quote), bobAmount, _proof(aliceLeaf));
        RecoveryRootView memory afterBob = vault.recoveryRoot(MARKET, EPOCH, address(quote));
        assertLe(afterBob.claimedTotal + vault.liability(MARKET, address(quote), 1), 20);
        assertLe(afterBob.claimedTotal, vault.recoveryCap(MARKET, EPOCH, address(quote)));
    }

    function _activateOther(bytes32 root) private {
        bytes memory d = abi.encodeCall(vault.proposeRecoveryRoot, (OTHER_MARKET, EPOCH, address(failing), root, 10));
        vm.prank(PROPOSER);
        manager.schedule(address(vault), d, uint48(block.timestamp + 1));
        vm.warp(block.timestamp + 1);
        vm.prank(PROPOSER);
        manager.execute(address(vault), d);
        vm.warp(block.timestamp + 2 days);
        vault.finalizeRecoveryRoot(OTHER_MARKET, EPOCH, address(failing), 1);
    }
}
