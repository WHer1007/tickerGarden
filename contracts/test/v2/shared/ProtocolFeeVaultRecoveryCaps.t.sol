// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {MarketConfig, MarketRuntime, MarketView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {ProtocolFeeVaultRecoveryCaps} from "../../../src/v2/shared/ProtocolFeeVaultRecoveryCaps.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract RecoveryCapsRegistryMock {
    mapping(bytes32 marketId => MarketView value) private _markets;

    function configure(
        bytes32 marketId,
        address quoteAsset,
        address memeToken,
        address gauge,
        address marketController,
        uint32 recoveryEpoch,
        uint8 marketStatus
    ) external {
        MarketConfig memory config;
        config.quoteAsset = quoteAsset;
        config.memeToken = memeToken;
        config.gauge = gauge;
        config.marketController = marketController;

        MarketRuntime memory runtime;
        runtime.recoveryEpoch = recoveryEpoch;
        runtime.marketStatus = marketStatus;
        _markets[marketId] = MarketView({config: config, runtime: runtime});
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract RecoveryCapsDependencyMock {}

contract ProtocolFeeVaultRecoveryCapsHarness is ProtocolFeeVaultRecoveryCaps {
    constructor(
        address marketRegistry,
        address poolManager,
        address creatorRevenueRegistry,
        address platformTreasury,
        bytes32 feePolicyId,
        address marketController
    )
        ProtocolFeeVaultRecoveryCaps(
            marketRegistry, poolManager, creatorRevenueRegistry, platformTreasury, feePolicyId, marketController
        )
    {}

    function creditStakerLiability(bytes32 marketId, address feeAsset, uint256 amount) external {
        _creditFeeLiabilities(marketId, 1, feeAsset, amount, 0, amount, 0);
    }
}

contract ProtocolFeeVaultRecoveryCapsTest is Test {
    event RecoveryCapsFrozen(
        bytes32 indexed marketId,
        uint32 indexed recoveryEpoch,
        uint64 snapshotBlock,
        bytes32 stateHash,
        address quoteAsset,
        uint256 quoteCap,
        address memeAsset,
        uint256 memeCap
    );

    uint8 private constant MARKET_STATUS_ACTIVE = 0;
    uint8 private constant MARKET_STATUS_PAUSED = 1;
    uint8 private constant MARKET_STATUS_RETIRED = 2;

    bytes32 private constant MARKET_ID = keccak256("recovery-caps-market");
    bytes32 private constant RETIRED_MARKET_ID = keccak256("recovery-caps-retired-market");
    bytes32 private constant UNKNOWN_MARKET_ID = keccak256("recovery-caps-unknown-market");
    bytes32 private constant STATE_HASH = keccak256("recovery-state");
    bytes32 private constant FEE_POLICY_ID = keccak256("recovery-fee-policy");
    address private constant MARKET_CONTROLLER = address(0xC011);
    address private constant UNAUTHORIZED = address(0xBAD);
    address private constant WRONG_CONTROLLER = address(0xC012);

    RecoveryCapsRegistryMock private registry;
    ProtocolFeeVaultRecoveryCapsHarness private vault;
    MockExactQuoteToken private quote;
    MockExactQuoteToken private meme;
    MockExactQuoteToken private third;
    RecoveryCapsDependencyMock private poolManager;
    RecoveryCapsDependencyMock private creatorRegistry;
    RecoveryCapsDependencyMock private treasury;
    RecoveryCapsDependencyMock private gauge;

    function setUp() public {
        vm.roll(100);
        registry = new RecoveryCapsRegistryMock();
        quote = new MockExactQuoteToken(6);
        meme = new MockExactQuoteToken(18);
        third = new MockExactQuoteToken(8);
        poolManager = new RecoveryCapsDependencyMock();
        creatorRegistry = new RecoveryCapsDependencyMock();
        treasury = new RecoveryCapsDependencyMock();
        gauge = new RecoveryCapsDependencyMock();
        vault = new ProtocolFeeVaultRecoveryCapsHarness(
            address(registry),
            address(poolManager),
            address(creatorRegistry),
            address(treasury),
            FEE_POLICY_ID,
            MARKET_CONTROLLER
        );

        registry.configure(
            MARKET_ID, address(quote), address(meme), address(gauge), MARKET_CONTROLLER, 0, MARKET_STATUS_PAUSED
        );
        quote.mint(address(vault), 20);
        meme.mint(address(vault), 30);
        vault.creditStakerLiability(MARKET_ID, address(quote), 20);
        vault.creditStakerLiability(MARKET_ID, address(meme), 30);
    }

    function test_freezeAcceptsControllerAndFreezesExactDualAssetStakerCaps() public {
        uint64 snapshotBlock = uint64(block.number - 1);

        vm.expectEmit(true, true, false, false, address(vault));
        emit RecoveryCapsFrozen(MARKET_ID, 1, snapshotBlock, STATE_HASH, address(quote), 20, address(meme), 30);
        vm.prank(MARKET_CONTROLLER);
        (uint256 quoteCap, uint256 memeCap) = vault.freezeRecoveryCaps(MARKET_ID, 1, snapshotBlock, STATE_HASH);

        assertEq(quoteCap, 20);
        assertEq(memeCap, 30);
        (uint64 storedBlock, bytes32 storedHash) = vault.recoverySnapshot(MARKET_ID, 1);
        assertEq(storedBlock, snapshotBlock);
        assertEq(storedHash, STATE_HASH);
        assertEq(vault.recoveryCap(MARKET_ID, 1, address(quote)), 20);
        assertEq(vault.recoveryCap(MARKET_ID, 1, address(meme)), 30);
        assertEq(vault.recoveryCap(MARKET_ID, 1, address(third)), 0);
    }

    function test_freezeRejectsNonController() public {
        uint64 snapshotBlock = uint64(block.number - 1);
        vm.prank(UNAUTHORIZED);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryCaps.UnauthorizedMarketController.selector, UNAUTHORIZED, MARKET_CONTROLLER
            )
        );
        vault.freezeRecoveryCaps(MARKET_ID, 1, snapshotBlock, STATE_HASH);
    }

    function test_freezeRejectsActiveMarketButAcceptsRetiredMarket() public {
        registry.configure(
            MARKET_ID, address(quote), address(meme), address(gauge), MARKET_CONTROLLER, 0, MARKET_STATUS_ACTIVE
        );
        uint64 snapshotBlock = uint64(block.number - 1);
        vm.prank(MARKET_CONTROLLER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryCaps.InvalidRecoverySnapshot.selector,
                MARKET_ID,
                uint32(1),
                snapshotBlock,
                STATE_HASH
            )
        );
        vault.freezeRecoveryCaps(MARKET_ID, 1, snapshotBlock, STATE_HASH);

        registry.configure(
            RETIRED_MARKET_ID,
            address(quote),
            address(meme),
            address(gauge),
            MARKET_CONTROLLER,
            0,
            MARKET_STATUS_RETIRED
        );
        vm.prank(MARKET_CONTROLLER);
        vault.freezeRecoveryCaps(RETIRED_MARKET_ID, 1, snapshotBlock, STATE_HASH);
        assertEq(vault.recoveryCap(RETIRED_MARKET_ID, 1, address(quote)), 0);
        assertEq(vault.recoveryCap(RETIRED_MARKET_ID, 1, address(meme)), 0);
    }

    function test_freezeRequiresCurrentEpochPlusOne() public {
        registry.configure(
            MARKET_ID, address(quote), address(meme), address(gauge), MARKET_CONTROLLER, 7, MARKET_STATUS_PAUSED
        );
        uint64 snapshotBlock = uint64(block.number - 1);
        vm.prank(MARKET_CONTROLLER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryCaps.InvalidRecoverySnapshot.selector,
                MARKET_ID,
                uint32(7),
                snapshotBlock,
                STATE_HASH
            )
        );
        vault.freezeRecoveryCaps(MARKET_ID, 7, snapshotBlock, STATE_HASH);

        vm.prank(MARKET_CONTROLLER);
        vault.freezeRecoveryCaps(MARKET_ID, 8, snapshotBlock, STATE_HASH);
        assertEq(vault.recoveryCap(MARKET_ID, 8, address(quote)), 20);
    }

    function test_freezeRequiresPreviousBlockAndNonzeroStateHash() public {
        uint64 snapshotBlock = uint64(block.number - 1);
        vm.prank(MARKET_CONTROLLER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryCaps.InvalidRecoverySnapshot.selector,
                MARKET_ID,
                uint32(1),
                snapshotBlock - 1,
                STATE_HASH
            )
        );
        vault.freezeRecoveryCaps(MARKET_ID, 1, snapshotBlock - 1, STATE_HASH);

        vm.prank(MARKET_CONTROLLER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryCaps.InvalidRecoverySnapshot.selector,
                MARKET_ID,
                uint32(1),
                snapshotBlock,
                bytes32(0)
            )
        );
        vault.freezeRecoveryCaps(MARKET_ID, 1, snapshotBlock, bytes32(0));
    }

    function test_freezeRejectsUnknownMarketAndWrongControllerBinding() public {
        uint64 snapshotBlock = uint64(block.number - 1);
        vm.prank(MARKET_CONTROLLER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryCaps.InvalidRecoverySnapshot.selector,
                UNKNOWN_MARKET_ID,
                uint32(1),
                snapshotBlock,
                STATE_HASH
            )
        );
        vault.freezeRecoveryCaps(UNKNOWN_MARKET_ID, 1, snapshotBlock, STATE_HASH);

        registry.configure(
            MARKET_ID, address(quote), address(meme), address(gauge), WRONG_CONTROLLER, 0, MARKET_STATUS_PAUSED
        );
        vm.prank(MARKET_CONTROLLER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryCaps.InvalidRecoverySnapshot.selector,
                MARKET_ID,
                uint32(1),
                snapshotBlock,
                STATE_HASH
            )
        );
        vault.freezeRecoveryCaps(MARKET_ID, 1, snapshotBlock, STATE_HASH);
    }

    function test_duplicateFreezeFailsAndUnknownAssetViewIsZero() public {
        uint64 snapshotBlock = uint64(block.number - 1);
        vm.prank(MARKET_CONTROLLER);
        vault.freezeRecoveryCaps(MARKET_ID, 1, snapshotBlock, STATE_HASH);

        vm.prank(MARKET_CONTROLLER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFeeVaultRecoveryCaps.RecoveryCapsAlreadyFrozen.selector, MARKET_ID, uint32(1)
            )
        );
        vault.freezeRecoveryCaps(MARKET_ID, 1, snapshotBlock, STATE_HASH);
        assertEq(vault.recoveryCap(MARKET_ID, 1, address(third)), 0);
        assertEq(vault.recoveryCap(MARKET_ID, 99, address(third)), 0);
    }

    function test_zeroCapsAreLegalAndLaterLiabilityChangesDoNotChangeFrozenCaps() public {
        registry.configure(
            RETIRED_MARKET_ID,
            address(quote),
            address(meme),
            address(gauge),
            MARKET_CONTROLLER,
            0,
            MARKET_STATUS_RETIRED
        );
        uint64 snapshotBlock = uint64(block.number - 1);
        vm.prank(MARKET_CONTROLLER);
        vault.freezeRecoveryCaps(RETIRED_MARKET_ID, 1, snapshotBlock, STATE_HASH);
        assertEq(vault.recoveryCap(RETIRED_MARKET_ID, 1, address(quote)), 0);
        assertEq(vault.recoveryCap(RETIRED_MARKET_ID, 1, address(meme)), 0);

        vm.prank(MARKET_CONTROLLER);
        vault.freezeRecoveryCaps(MARKET_ID, 1, snapshotBlock, STATE_HASH);
        quote.mint(address(vault), 5);
        meme.mint(address(vault), 7);
        vault.creditStakerLiability(MARKET_ID, address(quote), 5);
        vault.creditStakerLiability(MARKET_ID, address(meme), 7);

        assertEq(vault.liability(MARKET_ID, address(quote), 1), 25);
        assertEq(vault.liability(MARKET_ID, address(meme), 1), 37);
        assertEq(vault.recoveryCap(MARKET_ID, 1, address(quote)), 20);
        assertEq(vault.recoveryCap(MARKET_ID, 1, address(meme)), 30);
    }
}
