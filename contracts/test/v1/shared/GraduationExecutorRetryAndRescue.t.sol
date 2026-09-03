// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {MarketView, QuoteAssetConfig} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {GraduationExecutorEntry} from "../../../src/v1/shared/GraduationExecutorEntry.sol";
import {GraduationExecutorRetryAndRescue} from "../../../src/v1/shared/GraduationExecutorRetryAndRescue.sol";
import {
    PoolExecutionCurveCaller,
    PoolExecutionHookMock,
    PoolExecutionLocker,
    PoolExecutionPermit2Mock,
    PoolExecutionPoolManagerMock,
    PoolExecutionPositionManagerMock,
    PoolExecutionQuoteRegistryMock,
    PoolExecutionRegistryMock,
    PoolExecutionToken
} from "./GraduationExecutorPoolExecution.t.sol";

contract RetryAndRescueExecutorHarness is GraduationExecutorRetryAndRescue {
    constructor(
        address registry,
        address quoteRegistry,
        address poolManager,
        address positionManager,
        address hook,
        address dustRecipient,
        address rescueRecipient
    )
        GraduationExecutorRetryAndRescue(
            registry, quoteRegistry, poolManager, positionManager, hook, dustRecipient, rescueRecipient
        )
    {}

    function _launchLockerCreationCode() internal pure override returns (bytes memory) {
        return type(PoolExecutionLocker).creationCode;
    }
}

contract RejectingRescueRecipient {
    receive() external payable {
        revert("REJECT_RESCUE");
    }
}

contract GraduationExecutorRetryAndRescueTest is Test {
    bytes32 private constant MARKET_ID = keccak256("RETRY-AND-RESCUE");
    bytes32 private constant QUOTE_ID = keccak256("QUOTE-CONFIG");
    address private constant HOOK_ADDRESS = address(0x2044);
    address private constant DUST_RECIPIENT = address(0xD057);
    address private constant RESCUE_RECIPIENT = address(0xAE5C);
    uint256 private constant SWEPT_QUOTE = 40 ether;
    uint256 private constant SWEPT_MEME = 100 ether;
    uint256 private constant PHANTOM = 10 ether;

    PoolExecutionToken private meme;
    PoolExecutionToken private quote;
    PoolExecutionQuoteRegistryMock private quoteRegistry;
    PoolExecutionRegistryMock private registry;
    PoolExecutionPermit2Mock private permit2;
    PoolExecutionPoolManagerMock private poolManager;
    PoolExecutionPositionManagerMock private positionManager;
    PoolExecutionHookMock private hook;
    PoolExecutionCurveCaller private curve;
    RetryAndRescueExecutorHarness private executor;

    function setUp() public {
        meme = new PoolExecutionToken("MEME");
        quote = new PoolExecutionToken("QUOTE");
        quoteRegistry = new PoolExecutionQuoteRegistryMock();
        registry = new PoolExecutionRegistryMock(address(quoteRegistry));
        permit2 = new PoolExecutionPermit2Mock();
        poolManager = new PoolExecutionPoolManagerMock();
        positionManager = new PoolExecutionPositionManagerMock(address(poolManager), address(permit2));
        poolManager.setPositionManager(address(positionManager));

        PoolExecutionHookMock hookImplementation = new PoolExecutionHookMock();
        vm.etch(HOOK_ADDRESS, address(hookImplementation).code);
        hook = PoolExecutionHookMock(HOOK_ADDRESS);
        curve = new PoolExecutionCurveCaller();
        curve.setGraduationEscrow(SWEPT_QUOTE, SWEPT_MEME);

        _configureQuote(address(quote));
        registry.configure(MARKET_ID, QUOTE_ID, address(quote), address(meme), address(curve), address(hook));
        executor = new RetryAndRescueExecutorHarness(
            address(registry),
            address(quoteRegistry),
            address(poolManager),
            address(positionManager),
            address(hook),
            DUST_RECIPIENT,
            RESCUE_RECIPIENT
        );
        registry.setGraduationExecutor(address(executor));
        hook.configure(address(executor), address(poolManager));
    }

    function test_permissionlessRetryRunsCanonicalGraduationAndCommitsPoolCreated() public {
        quote.mint(address(executor), SWEPT_QUOTE);
        meme.mint(address(executor), SWEPT_MEME);
        address predictedLocker = executor.predictLaunchLocker(MARKET_ID);

        vm.prank(address(0xCA11));
        executor.retryGraduation(MARKET_ID);

        MarketView memory committed = registry.market(MARKET_ID);
        assertEq(committed.runtime.launchPhase, 2);
        assertEq(committed.runtime.sourceVersion, 2);
        assertEq(committed.runtime.sweptAt, 10);
        (uint256 tokenId, bytes32 poolId) = PoolExecutionLocker(payable(predictedLocker)).lockedPosition();
        assertEq(positionManager.ownerOf(tokenId), predictedLocker);
        assertEq(poolId, committed.runtime.poolId);
    }

    function test_constructorRejectsZeroAndProtocolDependencyRescueRecipients() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorRetryAndRescue.InvalidGraduationRescueRecipient.selector, address(0)
            )
        );
        new RetryAndRescueExecutorHarness(
            address(registry),
            address(quoteRegistry),
            address(poolManager),
            address(positionManager),
            address(hook),
            DUST_RECIPIENT,
            address(0)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorRetryAndRescue.InvalidGraduationRescueRecipient.selector, address(permit2)
            )
        );
        new RetryAndRescueExecutorHarness(
            address(registry),
            address(quoteRegistry),
            address(poolManager),
            address(positionManager),
            address(hook),
            DUST_RECIPIENT,
            address(permit2)
        );
    }

    function test_failedRetryRollsBackThenTheSameEscrowCanRetry() public {
        quote.mint(address(executor), SWEPT_QUOTE);
        meme.mint(address(executor), SWEPT_MEME);
        address predictedLocker = executor.predictLaunchLocker(MARKET_ID);
        hook.setFailActivation(true);

        vm.expectRevert("activation");
        executor.retryGraduation(MARKET_ID);

        assertEq(predictedLocker.code.length, 0);
        assertEq(quote.balanceOf(address(executor)), SWEPT_QUOTE);
        assertEq(meme.balanceOf(address(executor)), SWEPT_MEME);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 1);

        hook.setFailActivation(false);
        executor.retryGraduation(MARKET_ID);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 2);
    }

    function test_rescueIsPermissionlessInclusiveAndPreservesForcedBalances() public {
        quote.mint(address(executor), SWEPT_QUOTE + 7);
        meme.mint(address(executor), SWEPT_MEME + 9);
        vm.warp(10 + 7 days - 1);

        vm.expectRevert(
            abi.encodeWithSelector(GraduationExecutorRetryAndRescue.GraduationRescueNotReady.selector, 10 + 7 days)
        );
        executor.rescueSweptLaunch(MARKET_ID);

        vm.warp(10 + 7 days);
        vm.prank(address(0xCA11));
        executor.rescueSweptLaunch(MARKET_ID);

        MarketView memory rescued = registry.market(MARKET_ID);
        assertEq(rescued.runtime.launchPhase, 3);
        assertEq(rescued.runtime.sourceVersion, 1);
        assertEq(rescued.runtime.sweptAt, 10);
        assertEq(quote.balanceOf(RESCUE_RECIPIENT), SWEPT_QUOTE);
        assertEq(meme.balanceOf(RESCUE_RECIPIENT), SWEPT_MEME);
        assertEq(quote.balanceOf(address(executor)), 7);
        assertEq(meme.balanceOf(address(executor)), 9);

        vm.expectRevert(abi.encodeWithSelector(GraduationExecutorEntry.GraduationNotRetryable.selector, MARKET_ID, 3));
        executor.retryGraduation(MARKET_ID);
    }

    function test_nativeRescueUsesTheSameFrozenRecipientAndLeavesForcedBalance() public {
        _redeployForNativeQuote();
        vm.deal(address(executor), SWEPT_QUOTE + 3);
        meme.mint(address(executor), SWEPT_MEME + 5);
        vm.warp(10 + 7 days);

        executor.rescueSweptLaunch(MARKET_ID);

        assertEq(RESCUE_RECIPIENT.balance, SWEPT_QUOTE);
        assertEq(meme.balanceOf(RESCUE_RECIPIENT), SWEPT_MEME);
        assertEq(address(executor).balance, 3);
        assertEq(meme.balanceOf(address(executor)), 5);
    }

    function test_rejectedNativeRescueRollsBackTransfersAndRegistry() public {
        RejectingRescueRecipient rejectingRecipient = new RejectingRescueRecipient();
        _configureQuote(address(0));
        registry.configure(MARKET_ID, QUOTE_ID, address(0), address(meme), address(curve), address(hook));
        executor = new RetryAndRescueExecutorHarness(
            address(registry),
            address(quoteRegistry),
            address(poolManager),
            address(positionManager),
            address(hook),
            DUST_RECIPIENT,
            address(rejectingRecipient)
        );
        registry.setGraduationExecutor(address(executor));
        hook.configure(address(executor), address(poolManager));
        vm.deal(address(executor), SWEPT_QUOTE);
        meme.mint(address(executor), SWEPT_MEME);
        vm.warp(10 + 7 days);

        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorRetryAndRescue.GraduationRescueTransferFailed.selector,
                address(0),
                address(rejectingRecipient),
                SWEPT_QUOTE
            )
        );
        executor.rescueSweptLaunch(MARKET_ID);

        assertEq(address(executor).balance, SWEPT_QUOTE);
        assertEq(meme.balanceOf(address(executor)), SWEPT_MEME);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 1);
    }

    function test_missingCurveRecordCannotUseAggregateExecutorBalance() public {
        curve.setGraduationEscrow(0, 0);
        quote.mint(address(executor), SWEPT_QUOTE);
        meme.mint(address(executor), SWEPT_MEME);
        vm.warp(10 + 7 days);

        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationExecutorRetryAndRescue.InvalidRecordedGraduationEscrow.selector, MARKET_ID, 0, 0
            )
        );
        executor.rescueSweptLaunch(MARKET_ID);

        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 1);
        assertEq(quote.balanceOf(address(executor)), SWEPT_QUOTE);
        assertEq(meme.balanceOf(address(executor)), SWEPT_MEME);
    }

    function _redeployForNativeQuote() private {
        _configureQuote(address(0));
        registry.configure(MARKET_ID, QUOTE_ID, address(0), address(meme), address(curve), address(hook));
        executor = new RetryAndRescueExecutorHarness(
            address(registry),
            address(quoteRegistry),
            address(poolManager),
            address(positionManager),
            address(hook),
            DUST_RECIPIENT,
            RESCUE_RECIPIENT
        );
        registry.setGraduationExecutor(address(executor));
        hook.configure(address(executor), address(poolManager));
    }

    function _configureQuote(address quoteAsset) private {
        quoteRegistry.setQuote(
            QUOTE_ID,
            QuoteAssetConfig({
                ponsBaselineId: bytes32("PONS"),
                quoteAsset: quoteAsset,
                quoteDecimals: quoteAsset == address(0) ? 18 : 18,
                phantomQuote: PHANTOM,
                graduationThreshold: 25 ether,
                economicsHash: QUOTE_ID,
                status: 0
            })
        );
    }
}
