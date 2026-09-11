// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MarketView} from "../interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultV4Accounting} from "./ProtocolFeeVaultV4Accounting.sol";

interface IUserRewardGauge {
    function restoreUserMemeRewards(address user, uint256 memeRefund) external;
}

interface IUserRewardHook {
    function convertRewards(bytes32 id, uint256 amount, uint256 deadline)
        external
        returns (uint256 spent, uint256 received);
}

/// @notice User-owned reward conversion with exact balance verification and no preset price floor.
abstract contract ProtocolFeeVaultUserConversion is ProtocolFeeVaultV4Accounting {
    using SafeERC20 for IERC20;
    address private _payingConversionHook;
    error InvalidConversion();
    error ConversionBalanceMismatch();
    event RewardConverted(
        bytes32 indexed marketId,
        address indexed user,
        uint32 indexed creatorEpoch,
        uint256 memeSpent,
        uint256 quoteReceived
    );

    constructor(address registry, address manager, address creators, address treasury, bytes32 policy)
        ProtocolFeeVaultV4Accounting(registry, manager, creators, treasury, policy)
    {}

    function _isRewardSettlementPayment() internal view virtual override returns (bool) {
        return _payingConversionHook != address(0) && msg.sender == _payingConversionHook;
    }

    function _convertOwnedRewards(bytes32 marketId, MarketView memory value, uint256 total, uint256 deadline)
        internal
        returns (uint256 spent, uint256 received)
    {
        address meme = value.config.memeToken;
        address quote = value.config.quoteAsset;
        address hook = value.config.graduatedHook;
        _requireAssetSolvent(quote);
        uint256 memeBefore = _assetBalance(meme);
        uint256 quoteBefore = _assetBalance(quote);
        IERC20(meme).forceApprove(hook, total);
        _payingConversionHook = hook;
        (spent, received) = IUserRewardHook(hook).convertRewards(marketId, total, deadline);
        _payingConversionHook = address(0);
        IERC20(meme).forceApprove(hook, 0);
        if (
            spent == 0 || spent > total || received == 0 || _assetBalance(meme) + spent != memeBefore
                || _assetBalance(quote) != quoteBefore + received
        ) revert ConversionBalanceMismatch();
    }
}
