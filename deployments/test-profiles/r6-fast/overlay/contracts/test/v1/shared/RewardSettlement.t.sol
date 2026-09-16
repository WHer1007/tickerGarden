// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MarketConfig, MarketRuntime, MarketView, ConversionItem} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultRewardSettlement} from "../../../src/v1/shared/ProtocolFeeVaultRewardSettlement.sol";
import {ProtocolFeeVaultLiabilities} from "../../../src/v1/shared/ProtocolFeeVaultLiabilities.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

contract RewardSettlementBurnableToken is MockExactQuoteToken {
    constructor(uint8 decimals_) MockExactQuoteToken(decimals_) {}

    function burn(address account, uint256 amount) external {
        _transfer(account, address(0), amount);
    }
}

contract RewardSettlementRegistryMock {
    mapping(bytes32 => MarketView) private markets;

    function configure(bytes32 id, address hook, address quote, address meme, address gauge) external {
        MarketConfig memory c;
        c.graduatedHook = hook;
        c.quoteAsset = quote;
        c.memeToken = meme;
        c.gauge = gauge;
        c.stakingEnabled = true;
        c.feePolicyId = keccak256("policy");
        c.executionSpecId = keccak256("V1-EXEC-11");
        MarketRuntime memory r;
        r.poolId = keccak256("pool");
        r.sourceVersion = 1;
        r.launchPhase = 1;
        markets[id] = MarketView(c, r);
    }

    function disableStaking(bytes32 id) external {
        markets[id].config.stakingEnabled = false;
        markets[id].config.gauge = address(0);
    }

    function market(bytes32 id) external view returns (MarketView memory) {
        return markets[id];
    }

    function setLaunchPhase(bytes32 id, uint8 phase) external {
        markets[id].runtime.launchPhase = phase;
    }
}

contract RewardSettlementPoolManagerMock {}

contract RewardSettlementCreatorMock {
    mapping(bytes32 => uint32) public currentCreatorEpoch;
    mapping(bytes32 => mapping(uint32 => address)) public creatorBeneficiaryAt;

    function setEpoch(bytes32 id, uint32 epoch, address who) external {
        currentCreatorEpoch[id] = epoch;
        creatorBeneficiaryAt[id][epoch] = who;
    }
}

contract RewardSettlementGaugeMock {
    mapping(address => uint256) public reward;
    mapping(address => uint256) public quoteReward;
    bool public rejectConsume;

    function setReward(address who, uint256 amount) external {
        reward[who] = amount;
    }

    function setRejectConsume(bool value) external {
        rejectConsume = value;
    }

    function consumeForConversion(address who, uint256 maximum) external returns (uint256 amount) {
        require(!rejectConsume, "BAD_OPERATOR");
        amount = reward[who] < maximum ? reward[who] : maximum;
        reward[who] -= amount;
    }

    function creditConversion(address who, uint256 refund, uint256 quoteAmount) external {
        reward[who] += refund;
        quoteReward[who] += quoteAmount;
    }

    function consumeClaimable(address who, address asset) external returns (uint256 amount) {
        if (asset == address(0)) return 0;
        amount = quoteReward[who];
        quoteReward[who] = 0;
    }
}

contract RewardSettlementHookMock {
    MockExactQuoteToken public meme;
    MockExactQuoteToken public quote;
    bool public nativeQuote;
    bool public maliciousSpent;
    bool public maliciousReceived;
    uint256 public rate = 2;

    constructor(MockExactQuoteToken meme_, MockExactQuoteToken quote_, bool native_) {
        meme = meme_;
        quote = quote_;
        nativeQuote = native_;
    }
    receive() external payable {}

    function setModes(bool spent_, bool received_) external {
        maliciousSpent = spent_;
        maliciousReceived = received_;
    }

    function convertRewards(bytes32, uint256 amount, uint256, uint256)
        external
        returns (uint256 spent, uint256 received)
    {
        spent = maliciousSpent ? amount + 1 : amount;
        received = maliciousReceived ? 1 : amount * rate;
        if (amount != 0) meme.transferFrom(msg.sender, address(this), amount);
        if (nativeQuote) {
            (bool ok,) = payable(msg.sender).call{value: received}("");
            require(ok, "NATIVE");
        } else {
            quote.mint(msg.sender, received);
        }
    }
}

contract RewardSettlementHarness is ProtocolFeeVaultRewardSettlement {
    constructor(address registry, address manager, address creators, address treasury, bytes32 policy)
        ProtocolFeeVaultRewardSettlement(registry, manager, creators, treasury, policy)
    {}

    function seed(bytes32 id, uint32 epoch, address asset, uint256 amount, uint256 creator, uint256 staker) external {
        _creditFeeLiabilities(id, epoch, asset, amount, creator, staker, 0);
    }
}

contract RewardSettlementTest is Test {
    bytes32 constant ID = keccak256("reward-settlement");
    address constant TREASURY = address(0x7000);
    address constant CREATOR = address(0xC0FFEE);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    RewardSettlementRegistryMock registry;
    RewardSettlementCreatorMock creators;
    RewardSettlementGaugeMock gauge;
    RewardSettlementHarness vault;
    RewardSettlementBurnableToken meme;
    MockExactQuoteToken quote;
    RewardSettlementHookMock hook;
    RewardSettlementPoolManagerMock poolManager;

    function setUp() public {
        registry = new RewardSettlementRegistryMock();
        creators = new RewardSettlementCreatorMock();
        gauge = new RewardSettlementGaugeMock();
        poolManager = new RewardSettlementPoolManagerMock();
        meme = new RewardSettlementBurnableToken(18);
        quote = new MockExactQuoteToken(6);
        hook = new RewardSettlementHookMock(meme, quote, false);
        vault = new RewardSettlementHarness(
            address(registry), address(poolManager), address(creators), TREASURY, keccak256("policy")
        );
        registry.configure(ID, address(hook), address(quote), address(meme), address(gauge));
        creators.setEpoch(ID, 1, CREATOR);
        meme.mint(address(vault), 1_000);
    }

    function deadline() internal view returns (uint256) {
        return block.timestamp + 5 minutes;
    }

    function item(address who, uint32 epoch, uint256 max) internal pure returns (ConversionItem memory) {
        return ConversionItem(who, epoch, max);
    }

    function seedStaker(address who, uint256 amount) internal {
        gauge.setReward(who, amount);
        vault.seed(ID, 1, address(meme), amount, 0, amount);
    }

    function test_disabledStakingCreatorConversionAndQuoteClaimWithoutGauge() public {
        registry.disableStaking(ID);
        vault.seed(ID, 1, address(meme), 100, 100, 0);
        ConversionItem[] memory xs = new ConversionItem[](1);
        xs[0] = item(CREATOR, 1, 100);
        vm.prank(TREASURY);
        (uint256 spent, uint256 received) = vault.settleRewards(ID, xs, 200, deadline());
        assertEq(spent, 100);
        assertEq(received, 200);
        assertEq(vault.creatorLiability(ID, 1, address(meme)), 0);
        vm.prank(BOB);
        assertEq(vault.claimCreator(ID, 1, address(quote)), 200);
        assertEq(quote.balanceOf(CREATOR), 200);
        assertEq(quote.balanceOf(BOB), 0);
        assertEq(vault.totalLiability(address(quote)), 0);
        assertEq(vault.claimCreator(ID, 1, address(quote)), 0);
    }

    function test_disabledStakingCreatorRawExitStillRequiresDelay() public {
        registry.disableStaking(ID);
        vault.seed(ID, 1, address(meme), 10, 10, 0);
        vm.prank(CREATOR);
        vault.requestRawRewardExit(ID);
        uint256 availableAt = vault.rawRewardExitAt(ID, CREATOR);
        vm.expectRevert(abi.encodeWithSelector(
            ProtocolFeeVaultRewardSettlement.OriginalRewardExitNotReady.selector, availableAt
        ));
        vault.claimCreator(ID, 1, address(meme));
        vm.warp(availableAt);
        assertEq(vault.claimCreator(ID, 1, address(meme)), 10);
        assertEq(meme.balanceOf(CREATOR), 10);
        assertEq(vault.claimCreator(ID, 1, address(meme)), 0);
    }

    function test_disabledStakingCannotConvertStakerItems() public {
        registry.disableStaking(ID);
        ConversionItem[] memory xs = new ConversionItem[](1);
        xs[0] = item(ALICE, 0, 10);
        vm.prank(TREASURY);
        vm.expectRevert(ProtocolFeeVaultRewardSettlement.InvalidConversion.selector);
        vault.settleRewards(ID, xs, 1, deadline());
    }

    function test_creatorAndStakerBatchProRataPreservesFixedRecipients() public {
        vault.seed(ID, 1, address(meme), 100, 100, 0);
        seedStaker(ALICE, 100);
        ConversionItem[] memory xs = new ConversionItem[](2);
        xs[0] = item(CREATOR, 1, 100);
        xs[1] = item(ALICE, 0, 100);
        vm.prank(TREASURY);
        (uint256 spent, uint256 received) = vault.settleRewards(ID, xs, 300, deadline());
        assertEq(spent, 200);
        assertEq(received, 400);
        assertEq(vault.creatorLiability(ID, 1, address(quote)), 200);
        assertEq(vault.liability(ID, address(quote), 1), 200);
        assertEq(vault.creatorLiability(ID, 1, address(meme)), 0);
        assertEq(gauge.reward(ALICE), 0);
        assertEq(gauge.quoteReward(ALICE), 200);
    }

    function test_partialOutputRefundReturnsToOriginalOwner() public {
        seedStaker(ALICE, 100);
        ConversionItem[] memory xs = new ConversionItem[](1);
        xs[0] = item(ALICE, 0, 40);
        vm.prank(TREASURY);
        vault.settleRewards(ID, xs, 80, deadline());
        assertEq(gauge.reward(ALICE), 60);
        assertEq(gauge.quoteReward(ALICE), 80);
        assertEq(vault.liability(ID, address(meme), 1), 60);
    }

    function test_historicalEpochRecipientValidation() public {
        vault.seed(ID, 1, address(meme), 10, 10, 0);
        ConversionItem[] memory xs = new ConversionItem[](1);
        xs[0] = item(BOB, 1, 10);
        vm.prank(TREASURY);
        vm.expectRevert(ProtocolFeeVaultRewardSettlement.InvalidConversion.selector);
        vault.settleRewards(ID, xs, 1, deadline());
    }

    function test_minOutputAndBalanceMismatchRollback() public {
        seedStaker(ALICE, 10);
        ConversionItem[] memory xs = new ConversionItem[](1);
        xs[0] = item(ALICE, 0, 10);
        vm.prank(TREASURY);
        vm.expectRevert(ProtocolFeeVaultRewardSettlement.ConversionBalanceMismatch.selector);
        vault.settleRewards(ID, xs, 100, deadline());
        assertEq(gauge.reward(ALICE), 10);
        assertEq(vault.liability(ID, address(meme), 1), 10);
        hook.setModes(true, false);
        vm.prank(TREASURY);
        vm.expectRevert(ProtocolFeeVaultRewardSettlement.ConversionBalanceMismatch.selector);
        vault.settleRewards(ID, xs, 1, deadline());
        assertEq(gauge.reward(ALICE), 10);
        assertEq(vault.liability(ID, address(meme), 1), 10);
    }

    function test_badOperatorAndDuplicateItems() public {
        seedStaker(ALICE, 10);
        ConversionItem[] memory xs = new ConversionItem[](2);
        xs[0] = item(ALICE, 0, 2);
        xs[1] = item(ALICE, 0, 2);
        vm.expectRevert(ProtocolFeeVaultRewardSettlement.UnauthorizedSettlementOperator.selector);
        vault.settleRewards(ID, xs, 1, deadline());
        vm.prank(TREASURY);
        vm.expectRevert(ProtocolFeeVaultRewardSettlement.InvalidConversion.selector);
        vault.settleRewards(ID, xs, 1, deadline());
    }

    function test_rawExitBlocksClaimsUntilReadyAndSettlementExcludesReady() public {
        seedStaker(ALICE, 10);
        quote.mint(address(vault), 10);
        vm.prank(ALICE);
        vault.requestRawRewardExit(ID);
        uint256 availableAt = vault.rawRewardExitAt(ID, ALICE);
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultRewardSettlement.OriginalRewardExitNotReady.selector, availableAt)
        );
        vault.claimStaker(ID, address(meme));
        ConversionItem[] memory xs = new ConversionItem[](1);
        xs[0] = item(ALICE, 0, 10);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(TREASURY);
        vm.expectRevert(ProtocolFeeVaultRewardSettlement.InvalidConversion.selector);
        vault.settleRewards(ID, xs, 1, deadline());
    }

    function test_quoteClaimsUnaffectedByMemeExitGate() public {
        quote.mint(address(vault), 10);
        vault.seed(ID, 1, address(quote), 10, 0, 10);
        vm.prank(ALICE);
        vault.requestRawRewardExit(ID);
        vm.prank(ALICE);
        assertEq(vault.claimStaker(ID, address(quote)), 0);
    }

    function test_insufficientTotalBackingRollsBackSelectedBatch() public {
        seedStaker(ALICE, 10);
        seedStaker(BOB, 90);
        meme.burn(address(vault), 950); // 50 remains: enough for Alice, below total meme liabilities of 100.
        ConversionItem[] memory xs = new ConversionItem[](1);
        xs[0] = item(ALICE, 0, 10);
        vm.prank(TREASURY);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFeeVaultLiabilities.FeeVaultInsolvent.selector, address(meme), 50, 100)
        );
        vault.settleRewards(ID, xs, 1, deadline());
        assertEq(gauge.reward(ALICE), 10);
        assertEq(gauge.reward(BOB), 90);
        assertEq(vault.liability(ID, address(meme), 1), 100);
        assertEq(meme.balanceOf(address(vault)), 50);
    }

    function test_nativeQuoteConversionUsesExactBalanceDelta() public {
        RewardSettlementHookMock nativeHook = new RewardSettlementHookMock(meme, quote, true);
        vm.deal(address(nativeHook), 1_000);
        registry.configure(ID, address(nativeHook), address(0), address(meme), address(gauge));
        seedStaker(ALICE, 10);
        ConversionItem[] memory xs = new ConversionItem[](1);
        xs[0] = item(ALICE, 0, 10);
        vm.prank(TREASURY);
        vault.settleRewards(ID, xs, 20, deadline());
        assertEq(address(vault).balance, 20);
        assertEq(vault.liability(ID, address(0), 1), 20);
    }
}
