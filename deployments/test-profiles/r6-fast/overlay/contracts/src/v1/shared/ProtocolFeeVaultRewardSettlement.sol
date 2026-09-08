// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MarketView, ConversionItem} from "../interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultV4Accounting} from "./ProtocolFeeVaultV4Accounting.sol";

interface IRewardConversionGauge {
    function consumeForConversion(address user, uint256 maximum) external returns (uint256);
    function creditConversion(address user, uint256 memeRefund, uint256 quoteAmount) external;
}

interface IRewardConversionHook {
    function convertRewards(bytes32 marketId, uint256 amount, uint256 minimumQuote, uint256 deadline)
        external
        returns (uint256 spent, uint256 received);
}

/// @notice Converts already-owned rewards; never distributes against a later active-stake snapshot.
abstract contract ProtocolFeeVaultRewardSettlement is ProtocolFeeVaultV4Accounting {
    using SafeERC20 for IERC20;

    struct Totals {
        uint256 total;
        uint256 spent;
        uint256 received;
    }

    struct Progress {
        uint256 cumulative;
        uint256 spent;
        uint256 quote;
    }
    uint256 public constant RAW_EXIT_DELAY = 1 hours;
    uint256 public constant MAX_CONVERSION_ITEMS = 32;
    address public settlementOperator;
    mapping(bytes32 => mapping(address => uint256)) public rawRewardExitAt;
    mapping(bytes32 => uint256) public conversionNonce;
    address private _payingConversionHook;

    event HolderRewardsConverted(
        bytes32 indexed marketId,
        uint32 indexed epochId,
        address memeAsset,
        address quoteAsset,
        uint256 memeSpent,
        uint256 quoteReceived
    );
    event SettlementOperatorUpdated(address indexed operator);
    event RawRewardExitRequested(bytes32 indexed marketId, address indexed user, uint256 availableAt);
    event RawRewardExitCancelled(bytes32 indexed marketId, address indexed user);
    event RewardConverted(
        bytes32 indexed marketId,
        address indexed user,
        uint32 indexed creatorEpoch,
        uint256 memeSpent,
        uint256 quoteReceived
    );
    event RewardBatchConverted(
        bytes32 indexed marketId,
        uint256 indexed nonce,
        address memeAsset,
        address quoteAsset,
        uint256 memeSpent,
        uint256 quoteReceived
    );
    error UnauthorizedSettlementOperator();
    error InvalidConversion();
    error OriginalRewardExitNotReady(uint256 availableAt);
    error ConversionBalanceMismatch();

    constructor(address registry, address manager, address creators, address treasury, bytes32 policy)
        ProtocolFeeVaultV4Accounting(registry, manager, creators, treasury, policy)
    {
        settlementOperator = treasury;
    }

    /// @dev Existing immutable platform treasury controls this operational role, never payout destinations.
    function setSettlementOperator(address operator) external {
        if (msg.sender != _feePlatformTreasury || operator == address(0)) revert UnauthorizedSettlementOperator();
        settlementOperator = operator;
        emit SettlementOperatorUpdated(operator);
    }

    function requestRawRewardExit(bytes32 marketId) external {
        MarketView memory value = _feeMarketRegistry.market(marketId);
        _canonicalFeeMarket(marketId, value.config.memeToken);
        if (rawRewardExitAt[marketId][msg.sender] == 0) {
            uint256 availableAt = block.timestamp + RAW_EXIT_DELAY;
            rawRewardExitAt[marketId][msg.sender] = availableAt;
            emit RawRewardExitRequested(marketId, msg.sender, availableAt);
        }
    }

    function cancelRawRewardExit(bytes32 marketId) external {
        delete rawRewardExitAt[marketId][msg.sender];
        emit RawRewardExitCancelled(marketId, msg.sender);
    }

    function _beforeRewardClaim(bytes32 marketId, address asset, address beneficiary) internal view override {
        if (asset == _feeMarketRegistry.market(marketId).config.memeToken) {
            uint256 availableAt = rawRewardExitAt[marketId][beneficiary];
            if (availableAt == 0 || block.timestamp < availableAt) revert OriginalRewardExitNotReady(availableAt);
        }
    }

    function _isRewardSettlementPayment() internal view override returns (bool) {
        return _payingConversionHook != address(0) && msg.sender == _payingConversionHook;
    }

    function settleRewards(bytes32 marketId, ConversionItem[] calldata items, uint256 minimumQuote, uint256 deadline)
        external
        returns (uint256 spent, uint256 received)
    {
        if (msg.sender != settlementOperator) revert UnauthorizedSettlementOperator();
        if (
            items.length == 0 || items.length > MAX_CONVERSION_ITEMS || minimumQuote == 0 || deadline < block.timestamp
                || deadline > block.timestamp + 5 minutes
        ) revert InvalidConversion();
        _enterStandaloneOperation(bytes32("REWARD_CONVERSION"));
        MarketView memory value = _feeMarketRegistry.market(marketId);
        _canonicalFeeMarket(marketId, value.config.memeToken);
        if (value.runtime.launchPhase != 1) revert InvalidConversion();
        _requireAssetSolvent(value.config.memeToken);
        _requireAssetSolvent(value.config.quoteAsset);
        (uint256[] memory amounts, uint256 total) = _pullConversionItems(marketId, value, items);
        (spent, received) = _convertOwnedRewards(marketId, value, total, minimumQuote, deadline);
        _allocateConversion(marketId, value, items, amounts, Totals(total, spent, received));
        emit RewardBatchConverted(
            marketId, ++conversionNonce[marketId], value.config.memeToken, value.config.quoteAsset, spent, received
        );
        _exitStandaloneOperation();
    }

    /// @notice Converts collective holder revenue without moving it into a later TWAB window.
    function settleHolderRewards(
        bytes32 marketId,
        uint32 epochId,
        uint256 maximumMeme,
        uint256 minimumQuote,
        uint256 deadline
    ) external returns (uint256 spent, uint256 received) {
        if (msg.sender != settlementOperator) revert UnauthorizedSettlementOperator();
        if (
            maximumMeme == 0 || minimumQuote == 0 || deadline < block.timestamp
                || deadline > block.timestamp + 5 minutes
        ) revert InvalidConversion();
        _enterStandaloneOperation(bytes32("HOLDER_CONVERSION"));
        _holderDistributor(marketId);
        MarketView memory value = _feeMarketRegistry.market(marketId);
        if (value.runtime.launchPhase != 1) revert InvalidConversion();
        _requireAssetSolvent(value.config.memeToken);
        _requireAssetSolvent(value.config.quoteAsset);
        uint256 amount = Math.min(maximumMeme, holderLiability[marketId][epochId][value.config.memeToken]);
        if (amount == 0) revert InvalidConversion();
        _debitHolderFee(marketId, epochId, value.config.memeToken, amount);
        (spent, received) = _convertOwnedRewards(marketId, value, amount, minimumQuote, deadline);
        _creditHolderFee(marketId, epochId, value.config.memeToken, amount - spent);
        _creditHolderFee(marketId, epochId, value.config.quoteAsset, received);
        emit HolderRewardsConverted(marketId, epochId, value.config.memeToken, value.config.quoteAsset, spent, received);
        _exitStandaloneOperation();
    }

    function _pullConversionItems(bytes32 marketId, MarketView memory value, ConversionItem[] calldata items)
        private
        returns (uint256[] memory amounts, uint256 total)
    {
        amounts = new uint256[](items.length);
        for (uint256 i; i < items.length; ++i) {
            ConversionItem calldata item = items[i];
            if (item.user == address(0) || item.maximumMeme == 0) revert InvalidConversion();
            uint256 exitAt = rawRewardExitAt[marketId][item.user];
            if (exitAt != 0 && block.timestamp >= exitAt) revert InvalidConversion();
            for (uint256 j; j < i; ++j) {
                if (items[j].user == item.user && items[j].creatorEpoch == item.creatorEpoch) {
                    revert InvalidConversion();
                }
            }
            uint256 amount;
            if (item.creatorEpoch == 0) {
                if (!value.config.stakingEnabled) revert InvalidConversion();
                amount = IRewardConversionGauge(value.config.gauge).consumeForConversion(item.user, item.maximumMeme);
            } else {
                if (_feeCreatorRevenueRegistry.creatorBeneficiaryAt(marketId, item.creatorEpoch) != item.user) {
                    revert InvalidConversion();
                }
                amount = Math.min(
                    _creatorLiabilities[marketId][item.creatorEpoch][value.config.memeToken], item.maximumMeme
                );
                _creatorLiabilities[marketId][item.creatorEpoch][value.config.memeToken] -= amount;
            }
            if (amount == 0) revert InvalidConversion();
            _debitLiability(
                marketId,
                value.config.memeToken,
                item.creatorEpoch == 0 ? BUCKET_STAKER_REWARD : BUCKET_CREATOR_REVENUE,
                amount
            );
            amounts[i] = amount;
            total += amount;
        }
    }

    function _convertOwnedRewards(
        bytes32 marketId,
        MarketView memory value,
        uint256 total,
        uint256 minimumQuote,
        uint256 deadline
    ) private returns (uint256 spent, uint256 received) {
        address meme = value.config.memeToken;
        address quote = value.config.quoteAsset;
        address hook = value.config.graduatedHook;
        uint256 memeBefore = _assetBalance(meme);
        uint256 quoteBefore = _assetBalance(quote);
        IERC20(meme).forceApprove(hook, total);
        _payingConversionHook = hook;
        (spent, received) = IRewardConversionHook(hook).convertRewards(marketId, total, minimumQuote, deadline);
        _payingConversionHook = address(0);
        IERC20(meme).forceApprove(hook, 0);
        if (
            spent == 0 || spent > total || received < minimumQuote || _assetBalance(meme) + spent != memeBefore
                || _assetBalance(quote) != quoteBefore + received
        ) revert ConversionBalanceMismatch();
    }

    function _allocateConversion(
        bytes32 marketId,
        MarketView memory value,
        ConversionItem[] calldata items,
        uint256[] memory amounts,
        Totals memory totals
    ) private {
        Progress memory progress;
        for (uint256 i; i < items.length; ++i) {
            progress.cumulative += amounts[i];
            uint256 allocatedSpent = Math.mulDiv(progress.cumulative, totals.spent, totals.total);
            uint256 allocatedQuote = Math.mulDiv(allocatedSpent, totals.received, totals.spent);
            uint256 used = allocatedSpent - progress.spent;
            uint256 output = allocatedQuote - progress.quote;
            uint256 refund = amounts[i] - used;
            // Do not silently consume somebody's last raw unit for no payout.
            if (used != 0 && output == 0) revert InvalidConversion();
            _creditConvertedItem(marketId, value, items[i], used, refund, output);
            progress.spent = allocatedSpent;
            progress.quote = allocatedQuote;
        }
    }

    function _creditConvertedItem(
        bytes32 marketId,
        MarketView memory value,
        ConversionItem calldata item,
        uint256 used,
        uint256 refund,
        uint256 output
    ) private {
        uint32 epoch = item.creatorEpoch == 0
            ? _feeCreatorRevenueRegistry.currentCreatorEpoch(marketId)
            : item.creatorEpoch;
        bool staker = item.creatorEpoch == 0;
        if (staker) IRewardConversionGauge(value.config.gauge).creditConversion(item.user, refund, output);
        if (refund != 0) {
            _creditFeeLiabilities(
                marketId, epoch, value.config.memeToken, refund, staker ? 0 : refund, staker ? refund : 0, 0
            );
        }
        if (output != 0) {
            _creditFeeLiabilities(
                marketId, epoch, value.config.quoteAsset, output, staker ? 0 : output, staker ? output : 0, 0
            );
        }
        emit RewardConverted(marketId, item.user, item.creatorEpoch, used, output);
    }
}
