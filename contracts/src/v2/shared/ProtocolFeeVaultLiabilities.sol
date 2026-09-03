// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IMemeStockGauge, MarketView} from "../interfaces/IV2Protocol.sol";
import {ProtocolFeeVaultCurveCredit} from "./ProtocolFeeVaultCurveCredit.sol";

/// @notice Asset-isolated fee liabilities and fixed-recipient claims for the eventual ProtocolFeeVault.
abstract contract ProtocolFeeVaultLiabilities is ProtocolFeeVaultCurveCredit {
    using SafeERC20 for IERC20;

    uint8 internal constant BUCKET_CREATOR_REVENUE = 0;
    uint8 internal constant BUCKET_STAKER_REWARD = 1;
    uint8 internal constant BUCKET_PLATFORM_REVENUE = 2;
    uint8 private constant BUCKET_TYPE_COUNT = 3;

    address internal immutable _feePlatformTreasury;

    mapping(bytes32 marketId => mapping(address feeAsset => uint256[3] amounts)) private _bucketLiabilities;
    mapping(bytes32 marketId => mapping(uint32 creatorEpoch => mapping(address feeAsset => uint256 amount))) private
        _creatorLiabilities;
    mapping(address feeAsset => uint256 amount) private _totalLiabilities;

    event FeeBucketsCredited(
        bytes32 indexed marketId,
        uint32 indexed creatorEpoch,
        address indexed feeAsset,
        bytes32 feeId,
        uint256 creatorAmount,
        uint256 stakerAmount,
        uint256 platformAmount,
        uint256 activeStock,
        uint256 stakeSaturationAmount
    );
    event CurveFeesSwept(
        bytes32 indexed marketId,
        uint32 indexed creatorEpoch,
        address indexed quoteAsset,
        uint64 sweepNonce,
        bytes32 feeId,
        uint256 amount,
        uint256 creatorAmount,
        uint256 platformAmount
    );
    event FeeClaimed(
        uint8 indexed beneficiaryType,
        address indexed beneficiary,
        bytes32 indexed marketId,
        uint32 beneficiaryEpoch,
        address feeAsset,
        uint256 amount
    );

    error InvalidPlatformTreasury(address treasury);
    error InvalidFeeMarket(bytes32 marketId);
    error InvalidBucketType(uint8 bucket);
    error InvalidFeeBeneficiary(address beneficiary);
    error InvalidFeeLiabilityCredit(uint256 amount, uint256 bucketTotal);
    error InsufficientStakerLiability(bytes32 marketId, address feeAsset, uint256 liability, uint256 claimable);
    error FeeVaultInsolvent(address feeAsset, uint256 balance, uint256 liability);
    error NativeFeeClaimFailed(address beneficiary, uint256 amount);

    constructor(
        address marketRegistry_,
        address poolManager_,
        address creatorRevenueRegistry_,
        address platformTreasury_
    ) ProtocolFeeVaultCurveCredit(marketRegistry_, poolManager_, creatorRevenueRegistry_) {
        if (
            platformTreasury_ == address(0) || platformTreasury_ == address(this)
                || platformTreasury_ == marketRegistry_ || platformTreasury_ == poolManager_
                || platformTreasury_ == creatorRevenueRegistry_
        ) {
            revert InvalidPlatformTreasury(platformTreasury_);
        }
        _feePlatformTreasury = platformTreasury_;
    }

    function claimCreator(bytes32 marketId, uint32 creatorEpoch, address feeAsset) external returns (uint256 amount) {
        _enterStandaloneOperation(bytes32("CLAIM_CREATOR"));
        _canonicalFeeMarket(marketId, feeAsset);
        _requireSolvent(feeAsset, _totalLiabilities[feeAsset]);
        address beneficiary = _feeCreatorRevenueRegistry.creatorBeneficiaryAt(marketId, creatorEpoch);
        if (creatorEpoch == 0 || beneficiary == address(0)) revert InvalidFeeBeneficiary(beneficiary);

        amount = _creatorLiabilities[marketId][creatorEpoch][feeAsset];
        if (amount != 0) {
            _creatorLiabilities[marketId][creatorEpoch][feeAsset] = 0;
            _debitLiability(marketId, feeAsset, BUCKET_CREATOR_REVENUE, amount);
            _payFeeAsset(feeAsset, beneficiary, amount);
            emit FeeClaimed(BUCKET_CREATOR_REVENUE, beneficiary, marketId, creatorEpoch, feeAsset, amount);
        }
        _exitStandaloneOperation();
    }

    function claimPlatform(bytes32 marketId, address feeAsset) external returns (uint256 amount) {
        _enterStandaloneOperation(bytes32("CLAIM_PLATFORM"));
        _canonicalFeeMarket(marketId, feeAsset);
        _requireSolvent(feeAsset, _totalLiabilities[feeAsset]);
        amount = _bucketLiabilities[marketId][feeAsset][BUCKET_PLATFORM_REVENUE];
        if (amount != 0) {
            _debitLiability(marketId, feeAsset, BUCKET_PLATFORM_REVENUE, amount);
            _payFeeAsset(feeAsset, _feePlatformTreasury, amount);
            emit FeeClaimed(BUCKET_PLATFORM_REVENUE, _feePlatformTreasury, marketId, 0, feeAsset, amount);
        }
        _exitStandaloneOperation();
    }

    function claimStaker(bytes32 marketId, address feeAsset) external returns (uint256 amount) {
        return _claimStakerFor(msg.sender, marketId, feeAsset);
    }

    function claimStakerFor(address user, bytes32 marketId, address feeAsset) external returns (uint256 amount) {
        return _claimStakerFor(user, marketId, feeAsset);
    }

    function liability(bytes32 marketId, address feeAsset, uint8 bucket) external view returns (uint256) {
        if (bucket >= BUCKET_TYPE_COUNT) revert InvalidBucketType(bucket);
        return _bucketLiabilities[marketId][feeAsset][bucket];
    }

    function creatorLiability(bytes32 marketId, uint32 creatorEpoch, address feeAsset) external view returns (uint256) {
        return _creatorLiabilities[marketId][creatorEpoch][feeAsset];
    }

    function totalLiability(address feeAsset) external view returns (uint256) {
        return _totalLiabilities[feeAsset];
    }

    function consumedFeeId(bytes32 feeId) external view returns (bool) {
        return _consumedFeeIds[feeId];
    }

    function _creditFeeLiabilities(
        bytes32 marketId,
        uint32 creatorEpoch,
        address feeAsset,
        uint256 amount,
        uint256 creatorAmount,
        uint256 stakerAmount,
        uint256 platformAmount
    ) internal {
        uint256 bucketTotal = creatorAmount + stakerAmount + platformAmount;
        if (amount == 0 || bucketTotal != amount || creatorEpoch == 0) {
            revert InvalidFeeLiabilityCredit(amount, bucketTotal);
        }

        _creatorLiabilities[marketId][creatorEpoch][feeAsset] += creatorAmount;
        _bucketLiabilities[marketId][feeAsset][BUCKET_CREATOR_REVENUE] += creatorAmount;
        _bucketLiabilities[marketId][feeAsset][BUCKET_STAKER_REWARD] += stakerAmount;
        _bucketLiabilities[marketId][feeAsset][BUCKET_PLATFORM_REVENUE] += platformAmount;
        uint256 nextTotal = _totalLiabilities[feeAsset] + amount;
        _totalLiabilities[feeAsset] = nextTotal;
        _requireSolvent(feeAsset, nextTotal);
    }

    function _recordExactCurveCredit(CurveCreditRecord memory record) internal virtual override {
        _creditFeeLiabilities(
            record.marketId,
            record.creatorEpoch,
            record.quoteAsset,
            record.amount,
            record.creatorAmount,
            0,
            record.platformAmount
        );
        emit CurveFeesSwept(
            record.marketId,
            record.creatorEpoch,
            record.quoteAsset,
            record.sweepNonce,
            record.feeId,
            record.amount,
            record.creatorAmount,
            record.platformAmount
        );
    }

    function _claimStakerFor(address user, bytes32 marketId, address feeAsset) private returns (uint256 amount) {
        if (user == address(0)) revert InvalidFeeBeneficiary(user);
        _enterStandaloneOperation(bytes32("CLAIM_STAKER"));
        MarketView memory value = _canonicalFeeMarket(marketId, feeAsset);
        _requireSolvent(feeAsset, _totalLiabilities[feeAsset]);
        amount = IMemeStockGauge(value.config.gauge).consumeClaimable(user, feeAsset);
        uint256 available = _bucketLiabilities[marketId][feeAsset][BUCKET_STAKER_REWARD];
        if (amount > available) {
            revert InsufficientStakerLiability(marketId, feeAsset, available, amount);
        }
        if (amount != 0) {
            _debitLiability(marketId, feeAsset, BUCKET_STAKER_REWARD, amount);
            _payFeeAsset(feeAsset, user, amount);
            emit FeeClaimed(BUCKET_STAKER_REWARD, user, marketId, 0, feeAsset, amount);
        }
        _exitStandaloneOperation();
    }

    function _canonicalFeeMarket(bytes32 marketId, address feeAsset) internal view returns (MarketView memory value) {
        value = _feeMarketRegistry.market(marketId);
        if (marketId == bytes32(0) || value.config.memeToken == address(0) || value.config.gauge == address(0)) {
            revert InvalidFeeMarket(marketId);
        }
        if (feeAsset != value.config.quoteAsset && feeAsset != value.config.memeToken) {
            revert FeeAssetNotCanonical(feeAsset);
        }
    }

    function _debitLiability(bytes32 marketId, address feeAsset, uint8 bucket, uint256 amount) internal {
        _bucketLiabilities[marketId][feeAsset][bucket] -= amount;
        _totalLiabilities[feeAsset] -= amount;
    }

    function _payFeeAsset(address feeAsset, address beneficiary, uint256 amount) internal {
        if (feeAsset == address(0)) {
            (bool success,) = payable(beneficiary).call{value: amount}("");
            if (!success) revert NativeFeeClaimFailed(beneficiary, amount);
        } else {
            IERC20(feeAsset).safeTransfer(beneficiary, amount);
        }
        _requireSolvent(feeAsset, _totalLiabilities[feeAsset]);
    }

    function _requireSolvent(address feeAsset, uint256 required) internal view {
        uint256 balance = _assetBalance(feeAsset);
        if (balance < required) revert FeeVaultInsolvent(feeAsset, balance, required);
    }

    function _bucketLiability(bytes32 marketId, address feeAsset, uint8 bucket) internal view returns (uint256) {
        return _bucketLiabilities[marketId][feeAsset][bucket];
    }
}
