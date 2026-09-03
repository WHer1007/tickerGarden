// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {ICreatorRevenueRegistry, MarketView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {CreatorRevenueRegistry} from "../../../src/v2/modules/CreatorRevenueRegistry.sol";

contract MockCreatorMarketRegistry {
    bytes32 internal _marketId;
    MarketView internal _market;

    error UnknownMarket(bytes32 marketId);

    function setMarket(bytes32 marketId, address beneficiary, address curve, uint8 launchPhase) external {
        _marketId = marketId;
        _market.config.creatorRevenueBeneficiaryAtCreation = beneficiary;
        _market.config.curve = curve;
        _market.runtime.launchPhase = launchPhase;
    }

    function setLaunchPhase(uint8 launchPhase) external {
        _market.runtime.launchPhase = launchPhase;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        if (marketId != _marketId) revert UnknownMarket(marketId);
        return _market;
    }
}

contract MockCreatorCurve {
    uint256 public accruedCurveFees;
    uint256 public sweepCalls;
    uint32 public epochObservedDuringSweep;
    bool public failSweep;
    bool public leaveAccrued;
    bool public reenter;
    bool public reentrySucceeded;

    CreatorRevenueRegistry internal _registry;
    bytes32 internal _marketId;
    address internal _reentrantBeneficiary;

    function configure(CreatorRevenueRegistry registry, bytes32 marketId) external {
        _registry = registry;
        _marketId = marketId;
    }

    function setAccrued(uint256 amount) external {
        accruedCurveFees = amount;
    }

    function setFailure(bool value) external {
        failSweep = value;
    }

    function setLeaveAccrued(bool value) external {
        leaveAccrued = value;
    }

    function setReentry(address beneficiary) external {
        reenter = true;
        _reentrantBeneficiary = beneficiary;
    }

    function sweepCurveFees() external returns (uint256 amount) {
        if (failSweep) revert("SWEEP_FAILED");
        ++sweepCalls;
        epochObservedDuringSweep = _registry.currentCreatorEpoch(_marketId);
        if (reenter) {
            (reentrySucceeded,) = address(_registry)
                .call(
                    abi.encodeCall(
                        ICreatorRevenueRegistry.transferCreatorRevenueBeneficiary, (_marketId, _reentrantBeneficiary)
                    )
                );
        }
        amount = accruedCurveFees;
        if (!leaveAccrued) accruedCurveFees = 0;
    }

    function transferAsBeneficiary(address newBeneficiary) external returns (uint32) {
        return _registry.transferCreatorRevenueBeneficiary(_marketId, newBeneficiary);
    }
}

contract CreatorRevenueRegistryHarness is CreatorRevenueRegistry {
    constructor(address factory_, address marketRegistry_) CreatorRevenueRegistry(factory_, marketRegistry_) {}

    function forceEpoch(bytes32 marketId, uint32 epoch, address beneficiary) external {
        _currentCreatorEpoch[marketId] = epoch;
        _creatorBeneficiaries[marketId][epoch] = beneficiary;
    }
}

contract CreatorRevenueRegistryTest is Test {
    bytes32 internal constant MARKET_ID = keccak256("creator-market");
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant NEW_BENEFICIARY = address(0xCAFE);
    address internal constant THIRD_BENEFICIARY = address(0xD00D);
    address internal constant STRANGER = address(0xBAD);

    MockCreatorMarketRegistry internal marketRegistry;
    MockCreatorCurve internal curve;
    CreatorRevenueRegistry internal registry;

    event CreatorRevenueEpochInitialized(bytes32 indexed marketId, uint32 indexed epoch, address indexed beneficiary);
    event CreatorRevenueBeneficiaryUpdated(
        bytes32 indexed marketId,
        uint32 indexed oldEpoch,
        uint32 indexed newEpoch,
        address oldBeneficiary,
        address newBeneficiary
    );

    function setUp() public {
        marketRegistry = new MockCreatorMarketRegistry();
        curve = new MockCreatorCurve();
        registry = new CreatorRevenueRegistry(address(this), address(marketRegistry));
        curve.configure(registry, MARKET_ID);
        marketRegistry.setMarket(MARKET_ID, BENEFICIARY, address(curve), 0);
    }

    function test_constructorRejectsZeroAndAliasedDependencies() public {
        vm.expectRevert(CreatorRevenueRegistry.InvalidConstructorAddress.selector);
        new CreatorRevenueRegistry(address(0), address(marketRegistry));
        vm.expectRevert(CreatorRevenueRegistry.InvalidConstructorAddress.selector);
        new CreatorRevenueRegistry(address(this), address(0));
        vm.expectRevert(CreatorRevenueRegistry.InvalidConstructorAddress.selector);
        new CreatorRevenueRegistry(address(marketRegistry), address(marketRegistry));
    }

    function test_unknownMarketAndEpochZeroRemainUnset() public view {
        assertEq(registry.currentCreatorEpoch(keccak256("unknown")), 0);
        assertEq(registry.creatorBeneficiaryAt(MARKET_ID, 0), address(0));
        assertEq(registry.creatorBeneficiaryAt(MARKET_ID, 1), address(0));
    }

    function test_factoryInitializesEpochOneFromRegisteredMarketSnapshot() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit CreatorRevenueEpochInitialized(MARKET_ID, 1, BENEFICIARY);
        registry.initializeCreatorRevenueEpoch(MARKET_ID, BENEFICIARY);

        assertEq(registry.currentCreatorEpoch(MARKET_ID), 1);
        assertEq(registry.creatorBeneficiaryAt(MARKET_ID, 1), BENEFICIARY);
    }

    function test_initializeRequiresFactoryRegisteredMarketAndExactBeneficiary() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(CreatorRevenueRegistry.UnauthorizedFactory.selector, STRANGER));
        registry.initializeCreatorRevenueEpoch(MARKET_ID, BENEFICIARY);

        vm.expectRevert();
        registry.initializeCreatorRevenueEpoch(keccak256("unknown"), BENEFICIARY);

        vm.expectRevert(
            abi.encodeWithSelector(
                CreatorRevenueRegistry.InvalidInitialBeneficiary.selector, BENEFICIARY, NEW_BENEFICIARY
            )
        );
        registry.initializeCreatorRevenueEpoch(MARKET_ID, NEW_BENEFICIARY);
    }

    function test_initializeRejectsZeroMarketZeroBeneficiaryAndDuplicate() public {
        marketRegistry.setMarket(bytes32(0), BENEFICIARY, address(curve), 0);
        vm.expectRevert();
        registry.initializeCreatorRevenueEpoch(bytes32(0), BENEFICIARY);

        marketRegistry.setMarket(MARKET_ID, address(0), address(curve), 0);
        vm.expectRevert();
        registry.initializeCreatorRevenueEpoch(MARKET_ID, address(0));

        marketRegistry.setMarket(MARKET_ID, BENEFICIARY, address(curve), 0);
        registry.initializeCreatorRevenueEpoch(MARKET_ID, BENEFICIARY);
        vm.expectRevert(
            abi.encodeWithSelector(CreatorRevenueRegistry.CreatorRevenueEpochAlreadyInitialized.selector, MARKET_ID)
        );
        registry.initializeCreatorRevenueEpoch(MARKET_ID, BENEFICIARY);
        assertEq(registry.creatorBeneficiaryAt(MARKET_ID, 1), BENEFICIARY);
    }

    function test_notGraduatedSweepsOldEpochBeforeCheckedIncrement() public {
        _initialize();
        curve.setAccrued(100 ether);

        vm.expectEmit(true, true, true, true, address(registry));
        emit CreatorRevenueBeneficiaryUpdated(MARKET_ID, 1, 2, BENEFICIARY, NEW_BENEFICIARY);
        vm.prank(BENEFICIARY);
        uint32 newEpoch = registry.transferCreatorRevenueBeneficiary(MARKET_ID, NEW_BENEFICIARY);

        assertEq(newEpoch, 2);
        assertEq(curve.sweepCalls(), 1);
        assertEq(curve.epochObservedDuringSweep(), 1);
        assertEq(curve.accruedCurveFees(), 0);
        assertEq(registry.currentCreatorEpoch(MARKET_ID), 2);
        assertEq(registry.creatorBeneficiaryAt(MARKET_ID, 1), BENEFICIARY);
        assertEq(registry.creatorBeneficiaryAt(MARKET_ID, 2), NEW_BENEFICIARY);
    }

    function test_notGraduatedZeroAccruedStillExecutesNoOpSweep() public {
        _initialize();
        vm.prank(BENEFICIARY);
        registry.transferCreatorRevenueBeneficiary(MARKET_ID, NEW_BENEFICIARY);
        assertEq(curve.sweepCalls(), 1);
        assertEq(curve.epochObservedDuringSweep(), 1);
    }

    function test_onlyCurrentBeneficiaryCanTransferAndInputMustChange() public {
        _initialize();
        vm.prank(STRANGER);
        vm.expectRevert(
            abi.encodeWithSelector(
                CreatorRevenueRegistry.UnauthorizedCurrentBeneficiary.selector, STRANGER, BENEFICIARY
            )
        );
        registry.transferCreatorRevenueBeneficiary(MARKET_ID, NEW_BENEFICIARY);

        vm.startPrank(BENEFICIARY);
        vm.expectRevert(abi.encodeWithSelector(CreatorRevenueRegistry.InvalidNewBeneficiary.selector, address(0)));
        registry.transferCreatorRevenueBeneficiary(MARKET_ID, address(0));
        vm.expectRevert(abi.encodeWithSelector(CreatorRevenueRegistry.InvalidNewBeneficiary.selector, BENEFICIARY));
        registry.transferCreatorRevenueBeneficiary(MARKET_ID, BENEFICIARY);
        vm.stopPrank();

        assertEq(registry.currentCreatorEpoch(MARKET_ID), 1);
        assertEq(curve.sweepCalls(), 0);
    }

    function test_transferBeforeInitializationFailsClosed() public {
        vm.prank(BENEFICIARY);
        vm.expectRevert(
            abi.encodeWithSelector(CreatorRevenueRegistry.CreatorRevenueEpochNotInitialized.selector, MARKET_ID)
        );
        registry.transferCreatorRevenueBeneficiary(MARKET_ID, NEW_BENEFICIARY);
    }

    function test_sweepFailureOrResidualAccrualRollsBackEpoch() public {
        _initialize();
        curve.setAccrued(100 ether);
        curve.setFailure(true);
        vm.prank(BENEFICIARY);
        vm.expectRevert("SWEEP_FAILED");
        registry.transferCreatorRevenueBeneficiary(MARKET_ID, NEW_BENEFICIARY);
        assertEq(registry.currentCreatorEpoch(MARKET_ID), 1);
        assertEq(curve.accruedCurveFees(), 100 ether);

        curve.setFailure(false);
        curve.setLeaveAccrued(true);
        vm.prank(BENEFICIARY);
        vm.expectRevert(
            abi.encodeWithSelector(CreatorRevenueRegistry.CurveFeesOutstanding.selector, MARKET_ID, 100 ether)
        );
        registry.transferCreatorRevenueBeneficiary(MARKET_ID, NEW_BENEFICIARY);
        assertEq(registry.currentCreatorEpoch(MARKET_ID), 1);
        assertEq(curve.sweepCalls(), 0);
    }

    function test_closedLaunchPhasesDoNotResweepButStillRequireZeroAccrued() public {
        _initialize();
        address caller = BENEFICIARY;
        address next = NEW_BENEFICIARY;
        for (uint8 phase = 1; phase <= 3; ++phase) {
            marketRegistry.setLaunchPhase(phase);
            vm.prank(caller);
            registry.transferCreatorRevenueBeneficiary(MARKET_ID, next);
            caller = next;
            next = phase == 1 ? THIRD_BENEFICIARY : address(uint160(0xD00D + phase));
        }
        assertEq(curve.sweepCalls(), 0);
        assertEq(registry.currentCreatorEpoch(MARKET_ID), 4);

        curve.setAccrued(1);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(CreatorRevenueRegistry.CurveFeesOutstanding.selector, MARKET_ID, 1));
        registry.transferCreatorRevenueBeneficiary(MARKET_ID, address(0xF00D));
        assertEq(registry.currentCreatorEpoch(MARKET_ID), 4);
    }

    function test_epochIncrementCannotWrapUint32() public {
        CreatorRevenueRegistryHarness harness =
            new CreatorRevenueRegistryHarness(address(this), address(marketRegistry));
        curve.configure(harness, MARKET_ID);
        harness.forceEpoch(MARKET_ID, type(uint32).max, BENEFICIARY);
        marketRegistry.setLaunchPhase(1);

        vm.prank(BENEFICIARY);
        vm.expectRevert();
        harness.transferCreatorRevenueBeneficiary(MARKET_ID, NEW_BENEFICIARY);
        assertEq(harness.currentCreatorEpoch(MARKET_ID), type(uint32).max);
    }

    function test_sweepCallbackCannotReenterAndOverwriteNextEpoch() public {
        marketRegistry.setMarket(MARKET_ID, address(curve), address(curve), 0);
        registry.initializeCreatorRevenueEpoch(MARKET_ID, address(curve));
        curve.setAccrued(5 ether);
        curve.setReentry(THIRD_BENEFICIARY);

        uint32 newEpoch = curve.transferAsBeneficiary(NEW_BENEFICIARY);
        assertEq(newEpoch, 2);
        assertFalse(curve.reentrySucceeded());
        assertEq(registry.creatorBeneficiaryAt(MARKET_ID, 2), NEW_BENEFICIARY);
        assertEq(registry.creatorBeneficiaryAt(MARKET_ID, 3), address(0));
    }

    function test_selectorsMatchCanonicalInterface() public pure {
        assertEq(
            CreatorRevenueRegistry.initializeCreatorRevenueEpoch.selector,
            ICreatorRevenueRegistry.initializeCreatorRevenueEpoch.selector
        );
        assertEq(
            CreatorRevenueRegistry.transferCreatorRevenueBeneficiary.selector,
            ICreatorRevenueRegistry.transferCreatorRevenueBeneficiary.selector
        );
        assertEq(
            CreatorRevenueRegistry.currentCreatorEpoch.selector, ICreatorRevenueRegistry.currentCreatorEpoch.selector
        );
        assertEq(
            CreatorRevenueRegistry.creatorBeneficiaryAt.selector, ICreatorRevenueRegistry.creatorBeneficiaryAt.selector
        );
    }

    function _initialize() private {
        registry.initializeCreatorRevenueEpoch(MARKET_ID, BENEFICIARY);
    }
}
