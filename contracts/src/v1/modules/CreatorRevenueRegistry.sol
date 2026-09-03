// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {
    ICreatorRevenueRegistry,
    IMarketRegistryV1,
    IPonsCompatibleCurve,
    MarketView
} from "../interfaces/IV1Protocol.sol";

/// @notice The sole authority for append-only creator revenue beneficiary epochs.
contract CreatorRevenueRegistry is ICreatorRevenueRegistry, ReentrancyGuard {
    uint32 internal constant INITIAL_CREATOR_EPOCH = 1;
    uint8 internal constant LAUNCH_PHASE_NOT_GRADUATED = 0;

    address public immutable factory;
    address public immutable marketRegistry;

    mapping(bytes32 marketId => uint32 epoch) internal _currentCreatorEpoch;
    mapping(bytes32 marketId => mapping(uint32 epoch => address beneficiary)) internal _creatorBeneficiaries;

    error InvalidConstructorAddress();
    error UnauthorizedFactory(address caller);
    error CreatorRevenueEpochAlreadyInitialized(bytes32 marketId);
    error InvalidInitialBeneficiary(address expected, address supplied);
    error CreatorRevenueEpochNotInitialized(bytes32 marketId);
    error UnauthorizedCurrentBeneficiary(address caller, address expected);
    error InvalidNewBeneficiary(address beneficiary);
    error CurveFeesOutstanding(bytes32 marketId, uint256 amount);
    error CreatorRevenueEpochAlreadyWritten(bytes32 marketId, uint32 epoch);

    constructor(address factory_, address marketRegistry_) {
        if (factory_ == address(0) || marketRegistry_ == address(0) || factory_ == marketRegistry_) {
            revert InvalidConstructorAddress();
        }
        factory = factory_;
        marketRegistry = marketRegistry_;
    }

    function initializeCreatorRevenueEpoch(bytes32 marketId, address beneficiary) external override nonReentrant {
        if (msg.sender != factory) revert UnauthorizedFactory(msg.sender);
        if (_currentCreatorEpoch[marketId] != 0) revert CreatorRevenueEpochAlreadyInitialized(marketId);

        MarketView memory marketView = IMarketRegistryV1(marketRegistry).market(marketId);
        address expectedBeneficiary = marketView.config.creatorRevenueBeneficiaryAtCreation;
        if (marketId == bytes32(0) || beneficiary == address(0) || beneficiary != expectedBeneficiary) {
            revert InvalidInitialBeneficiary(expectedBeneficiary, beneficiary);
        }

        _currentCreatorEpoch[marketId] = INITIAL_CREATOR_EPOCH;
        _creatorBeneficiaries[marketId][INITIAL_CREATOR_EPOCH] = beneficiary;
        emit CreatorRevenueEpochInitialized(marketId, INITIAL_CREATOR_EPOCH, beneficiary);
    }

    function transferCreatorRevenueBeneficiary(bytes32 marketId, address newBeneficiary)
        external
        override
        nonReentrant
        returns (uint32 newEpoch)
    {
        uint32 oldEpoch = _currentCreatorEpoch[marketId];
        if (oldEpoch == 0) revert CreatorRevenueEpochNotInitialized(marketId);

        address oldBeneficiary = _creatorBeneficiaries[marketId][oldEpoch];
        if (msg.sender != oldBeneficiary) revert UnauthorizedCurrentBeneficiary(msg.sender, oldBeneficiary);
        if (newBeneficiary == address(0) || newBeneficiary == oldBeneficiary) {
            revert InvalidNewBeneficiary(newBeneficiary);
        }

        MarketView memory marketView = IMarketRegistryV1(marketRegistry).market(marketId);
        IPonsCompatibleCurve curve = IPonsCompatibleCurve(marketView.config.curve);
        if (marketView.runtime.launchPhase == LAUNCH_PHASE_NOT_GRADUATED) curve.sweepCurveFees();

        uint256 accruedFees = curve.accruedCurveFees();
        if (accruedFees != 0) revert CurveFeesOutstanding(marketId, accruedFees);

        newEpoch = oldEpoch + 1;
        if (_creatorBeneficiaries[marketId][newEpoch] != address(0)) {
            revert CreatorRevenueEpochAlreadyWritten(marketId, newEpoch);
        }
        _currentCreatorEpoch[marketId] = newEpoch;
        _creatorBeneficiaries[marketId][newEpoch] = newBeneficiary;
        emit CreatorRevenueBeneficiaryUpdated(marketId, oldEpoch, newEpoch, oldBeneficiary, newBeneficiary);
    }

    function currentCreatorEpoch(bytes32 marketId) external view override returns (uint32) {
        return _currentCreatorEpoch[marketId];
    }

    function creatorBeneficiaryAt(bytes32 marketId, uint32 epoch) external view override returns (address) {
        return _creatorBeneficiaries[marketId][epoch];
    }
}
