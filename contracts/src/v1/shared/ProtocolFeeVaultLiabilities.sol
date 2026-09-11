// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IMemeStockGauge, ITickerMemeTokenV1, MarketView} from "../interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultCurveCredit} from "./ProtocolFeeVaultCurveCredit.sol";

interface IHolderDistribution {
    function fundQuoteRewards(bytes32 marketId, uint32 epochId, uint256 amount) external payable;
}

/// @notice Asset-isolated fee liabilities and fixed-recipient claims for the eventual ProtocolFeeVault.
abstract contract ProtocolFeeVaultLiabilities is ProtocolFeeVaultCurveCredit {
    using SafeERC20 for IERC20;

    uint8 internal constant BUCKET_CREATOR_REVENUE = 0;
    uint8 internal constant BUCKET_STAKER_REWARD = 1;
    uint8 internal constant BUCKET_PLATFORM_REVENUE = 2;
    uint8 internal constant BUCKET_HOLDER_REWARD = 3;
    uint8 private constant BUCKET_TYPE_COUNT = 4;

    address internal immutable _feePlatformTreasury;

    mapping(bytes32 marketId => mapping(address feeAsset => uint256[4] amounts)) internal _bucketLiabilities;
    mapping(bytes32 marketId => mapping(uint32 creatorEpoch => mapping(address feeAsset => uint256 amount))) internal
        _creatorLiabilities;
    mapping(bytes32 marketId => mapping(address feeAsset => uint256 amount)) private _forfeitureReserves;
    mapping(address feeAsset => uint256 amount) internal _totalLiabilities;

    mapping(bytes32 => mapping(uint32 => mapping(address => uint256))) public holderLiability;
    event HolderFeesAccrued(bytes32 indexed marketId, uint32 indexed epochId, address indexed feeAsset, uint256 amount);
    error CreatorFeesAssignedToHolders();

    event FeeBucketsCredited(
        bytes32 indexed marketId,
        uint32 indexed creatorEpoch,
        address indexed feeAsset,
        bytes32 feeId,
        uint256 creatorAmount,
        uint256 stakerAmount,
        uint256 platformAmount,
        uint256 activeStock
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
    event ForfeitureReserved(
        bytes32 indexed marketId, address indexed user, address indexed feeAsset, uint256 amount, uint256 reserveBalance
    );
    event ForfeitureReserveConverted(bytes32 indexed marketId, address indexed feeAsset, uint256 amount);

    error InvalidPlatformTreasury(address treasury);
    error InvalidFeeMarket(bytes32 marketId);
    error InvalidBucketType(uint8 bucket);
    error InvalidFeeBeneficiary(address beneficiary);
    error InvalidFeeLiabilityCredit(uint256 amount, uint256 bucketTotal);
    error InsufficientStakerLiability(bytes32 marketId, address feeAsset, uint256 liability, uint256 claimable);
    error FeeVaultInsolvent(address feeAsset, uint256 balance, uint256 liability);
    error NativeFeeClaimFailed(address beneficiary, uint256 amount);
    error InexactFeePayment(
        address feeAsset, address beneficiary, uint256 expected, uint256 vaultDecrease, uint256 beneficiaryIncrease
    );
    error UnauthorizedForfeitureGauge(address caller, address expectedGauge);
    error InvalidForfeiture(address user, uint256 quoteAmount, uint256 memeAmount);

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

    function claimPlatform(bytes32 marketId, address feeAsset) external returns (uint256 amount) {
        _enterStandaloneOperation(bytes32("CLAIM_PLATFORM"));
        _canonicalFeeMarket(marketId, feeAsset);
        _convertForfeitureReserve(marketId, feeAsset);
        _requireSolvent(feeAsset, _totalLiabilities[feeAsset]);
        amount = _bucketLiabilities[marketId][feeAsset][BUCKET_PLATFORM_REVENUE];
        if (amount != 0) {
            _debitLiability(marketId, feeAsset, BUCKET_PLATFORM_REVENUE, amount);
            _payFeeAsset(feeAsset, _feePlatformTreasury, amount);
            emit FeeClaimed(BUCKET_PLATFORM_REVENUE, _feePlatformTreasury, marketId, 0, feeAsset, amount);
        }
        _exitStandaloneOperation();
    }

    function recordForfeiture(bytes32 marketId, address user, uint256 quoteAmount, uint256 memeAmount) external {
        _enterStandaloneOperation(bytes32("RECORD_FORFEITURE"));
        MarketView memory value = _feeMarketRegistry.market(marketId);
        if (marketId == bytes32(0) || value.config.memeToken == address(0) || value.config.gauge == address(0)) {
            revert InvalidFeeMarket(marketId);
        }
        if (msg.sender != value.config.gauge) {
            revert UnauthorizedForfeitureGauge(msg.sender, value.config.gauge);
        }
        if (user == address(0) || (quoteAmount == 0 && memeAmount == 0)) {
            revert InvalidForfeiture(user, quoteAmount, memeAmount);
        }

        _reserveForfeiture(marketId, user, value.config.quoteAsset, quoteAmount);
        _reserveForfeiture(marketId, user, value.config.memeToken, memeAmount);
        _requireSolvent(value.config.quoteAsset, _totalLiabilities[value.config.quoteAsset]);
        if (value.config.memeToken != value.config.quoteAsset) {
            _requireSolvent(value.config.memeToken, _totalLiabilities[value.config.memeToken]);
        }
        _exitStandaloneOperation();
    }

    function liability(bytes32 marketId, address feeAsset, uint8 bucket) external view returns (uint256) {
        if (bucket >= BUCKET_TYPE_COUNT) revert InvalidBucketType(bucket);
        return _bucketLiabilities[marketId][feeAsset][bucket];
    }

    function creatorLiability(bytes32 marketId, uint32 creatorEpoch, address feeAsset) external view returns (uint256) {
        return _creatorLiabilities[marketId][creatorEpoch][feeAsset];
    }

    function forfeitureReserve(bytes32 marketId, address feeAsset) external view returns (uint256) {
        return _forfeitureReserves[marketId][feeAsset];
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

    /// @dev Split only newly collected base creator fees, never tax or converted/refunded rewards.
    function _creditTradingFeeLiabilities(
        bytes32 marketId,
        uint32 creatorEpoch,
        address feeAsset,
        uint256 amount,
        uint256 creatorAmount,
        uint256 stakerAmount,
        uint256 platformAmount,
        uint256 creatorTaxAmount,
        MarketView memory value
    ) internal returns (uint256 holderAmount) {
        if (creatorTaxAmount > creatorAmount) {
            revert InvalidFeeLiabilityCredit(amount, creatorTaxAmount);
        }
        _creditFeeLiabilities(marketId, creatorEpoch, feeAsset, amount, creatorAmount, stakerAmount, platformAmount);
        if (value.config.creatorFeesToHolders) {
            holderAmount = (creatorAmount - creatorTaxAmount) / 2;
            if (holderAmount != 0) {
                uint32 holderEpoch = _holderRewardBucket(marketId, value.config.memeToken);
                _creatorLiabilities[marketId][creatorEpoch][feeAsset] -= holderAmount;
                _bucketLiabilities[marketId][feeAsset][BUCKET_CREATOR_REVENUE] -= holderAmount;
                _bucketLiabilities[marketId][feeAsset][BUCKET_HOLDER_REWARD] += holderAmount;
                holderLiability[marketId][holderEpoch][feeAsset] += holderAmount;
                emit HolderFeesAccrued(marketId, holderEpoch, feeAsset, holderAmount);
            }
        }
    }

    function _holderRewardBucket(bytes32, address) internal view virtual returns (uint32) {
        return 1;
    }

    function _holderDistributor(MarketView memory value) internal view returns (address) {
        if (!value.config.creatorFeesToHolders) revert CreatorFeesAssignedToHolders();
        return ITickerMemeTokenV1(value.config.memeToken).holderRewardsDistributor();
    }

    function _creditHolderFee(bytes32 marketId, uint32 epochId, address asset, uint256 amount) internal {
        if (amount == 0) return;
        holderLiability[marketId][epochId][asset] += amount;
        _bucketLiabilities[marketId][asset][BUCKET_HOLDER_REWARD] += amount;
        _totalLiabilities[asset] += amount;
        _requireAssetSolvent(asset);
    }

    function _debitHolderFee(bytes32 marketId, uint32 epochId, address asset, uint256 amount) internal {
        holderLiability[marketId][epochId][asset] -= amount;
        _debitLiability(marketId, asset, BUCKET_HOLDER_REWARD, amount);
    }

    /// @notice Permissionless transfer to the fixed holder distributor and original accounting epoch.
    function fundHolderRewards(bytes32 marketId, uint32 epochId) external returns (uint256 amount) {
        _enterStandaloneOperation(bytes32("FUND_HOLDER_REWARDS"));
        MarketView memory value = _feeMarketRegistry.market(marketId);
        address distributor = _holderDistributor(value);
        address quote = value.config.quoteAsset;
        _requireAssetSolvent(quote);
        amount = holderLiability[marketId][epochId][quote];
        if (amount != 0) {
            uint256 beforeBalance = _assetBalance(quote);
            _debitHolderFee(marketId, epochId, quote, amount);
            if (quote != address(0)) IERC20(quote).forceApprove(distributor, amount);
            _fundHolderQuote(distributor, marketId, epochId, quote, amount);
            if (quote != address(0)) IERC20(quote).forceApprove(distributor, 0);
            if (_assetBalance(quote) + amount != beforeBalance) {
                revert InexactFeePayment(quote, distributor, amount, 0, 0);
            }
            _requireAssetSolvent(quote);
        }
        _exitStandaloneOperation();
    }

    function _fundHolderQuote(address distributor, bytes32 id, uint32 bucket, address quote, uint256 amount)
        internal
        virtual
    {
        IHolderDistribution(distributor).fundQuoteRewards{value: quote == address(0) ? amount : 0}(id, bucket, amount);
    }

    function _reserveForfeiture(bytes32 marketId, address user, address feeAsset, uint256 amount) private {
        if (amount == 0) return;
        uint256 available = _bucketLiabilities[marketId][feeAsset][BUCKET_STAKER_REWARD];
        if (amount > available) {
            revert InsufficientStakerLiability(marketId, feeAsset, available, amount);
        }
        _bucketLiabilities[marketId][feeAsset][BUCKET_STAKER_REWARD] = available - amount;
        uint256 reserveBalance = _forfeitureReserves[marketId][feeAsset] + amount;
        _forfeitureReserves[marketId][feeAsset] = reserveBalance;
        emit ForfeitureReserved(marketId, user, feeAsset, amount, reserveBalance);
    }

    function _convertForfeitureReserve(bytes32 marketId, address feeAsset) private {
        uint256 amount = _forfeitureReserves[marketId][feeAsset];
        if (amount == 0) return;
        _forfeitureReserves[marketId][feeAsset] = 0;
        _bucketLiabilities[marketId][feeAsset][BUCKET_PLATFORM_REVENUE] += amount;
        emit ForfeitureReserveConverted(marketId, feeAsset, amount);
    }

    function _recordExactCurveCredit(CurveCreditRecord memory record, MarketView memory value)
        internal
        virtual
        override
    {
        uint256 holderAmount = _creditTradingFeeLiabilities(
            record.marketId,
            record.creatorEpoch,
            record.quoteAsset,
            record.amount,
            record.creatorAmount,
            0,
            record.platformAmount,
            record.creatorTaxAmount,
            value
        );
        emit CurveFeesSwept(
            record.marketId,
            record.creatorEpoch,
            record.quoteAsset,
            record.sweepNonce,
            record.feeId,
            record.amount,
            record.creatorAmount - holderAmount,
            record.platformAmount
        );
    }

    function _canonicalFeeMarket(bytes32 marketId, address feeAsset) internal view returns (MarketView memory value) {
        value = _feeMarketRegistry.market(marketId);
        _validateFeeMarket(marketId, feeAsset, value);
    }

    function _validateFeeMarket(bytes32 marketId, address feeAsset, MarketView memory value) internal pure {
        // Non-staking markets legitimately have no Gauge; creator/platform revenue remains claimable.
        if (
            marketId == bytes32(0) || value.config.memeToken == address(0)
                || (value.config.stakingEnabled && value.config.gauge == address(0))
        ) {
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
            IERC20 token = IERC20(feeAsset);
            uint256 vaultBalanceBefore = token.balanceOf(address(this));
            uint256 beneficiaryBalanceBefore = token.balanceOf(beneficiary);
            token.safeTransfer(beneficiary, amount);
            uint256 vaultBalanceAfter = token.balanceOf(address(this));
            uint256 beneficiaryBalanceAfter = token.balanceOf(beneficiary);
            uint256 vaultDecrease =
                vaultBalanceBefore >= vaultBalanceAfter ? vaultBalanceBefore - vaultBalanceAfter : type(uint256).max;
            uint256 beneficiaryIncrease = beneficiaryBalanceAfter >= beneficiaryBalanceBefore
                ? beneficiaryBalanceAfter - beneficiaryBalanceBefore
                : type(uint256).max;
            if (vaultDecrease != amount || beneficiaryIncrease != amount) {
                revert InexactFeePayment(feeAsset, beneficiary, amount, vaultDecrease, beneficiaryIncrease);
            }
        }
        _requireSolvent(feeAsset, _totalLiabilities[feeAsset]);
    }

    function _requireAssetSolvent(address feeAsset) internal view {
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
