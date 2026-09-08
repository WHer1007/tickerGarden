// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CreateMarketParams, ITickerGardenCurve, QuoteAssetConfig} from "../interfaces/IV1Protocol.sol";
import {LaunchAndBuyRouterNative} from "./LaunchAndBuyRouterNative.sol";

/// @notice Exact-arrival ERC-20 Quote composition shared by the final LaunchAndBuyRouter.
abstract contract LaunchAndBuyRouterERC20 is LaunchAndBuyRouterNative {
    uint8 private constant CONFIG_STATUS_ACTIVE = 1;

    struct ERC20LaunchState {
        address quoteAsset;
        address curve;
        uint256 nativeBalanceBefore;
        uint256 quoteBalanceBefore;
        uint256 quoteSpent;
    }

    error Erc20QuoteRequired(bytes32 quoteAssetConfigId);
    error QuoteTransferCallFailed(address quoteAsset);
    error InvalidQuoteTransferReturn(address quoteAsset);
    error InvalidQuoteBalanceRead(address quoteAsset, address account);
    error InvalidQuoteAllowanceRead(address quoteAsset, address owner, address spender);
    error InexactQuoteBalanceDelta(address quoteAsset, uint256 expected, uint256 actual);
    error InexactQuoteAllowance(address quoteAsset, address spender, uint256 expected, uint256 actual);

    constructor(address factory_, address approvedQuoteRegistry_)
        LaunchAndBuyRouterNative(factory_, approvedQuoteRegistry_)
    {}

    function _launchAndBuyERC20(
        address creator,
        CreateMarketParams calldata params,
        uint256 firstBuyAmount,
        uint256 minTokensOut,
        address recipient
    ) internal returns (bytes32 marketId, address memeToken, uint256 tokensOut, uint256 refund) {
        _requireLaunchInput(creator, firstBuyAmount, recipient);
        _requireFactoryBinding();
        ERC20LaunchState memory state;
        state.quoteAsset = _requireERC20Quote(params.quoteAssetConfigId);

        uint256 fee = _launchFactory.launchFee();
        if (msg.value != fee) revert InvalidLaunchAndBuyValue(fee, msg.value);
        state.nativeBalanceBefore = address(this).balance - msg.value;
        state.quoteBalanceBefore = _balanceOf(state.quoteAsset, address(this));
        _pullQuoteExact(state.quoteAsset, creator, firstBuyAmount, state.quoteBalanceBefore);

        (marketId, memeToken, state.curve,) = _launchFactory.createMarketFor{value: fee}(creator, params);
        _requireCreatedMarket(marketId, memeToken, state.curve);
        _approveCurveExact(state.quoteAsset, state.curve, firstBuyAmount);

        (tokensOut, state.quoteSpent) = ITickerGardenCurve(state.curve).buy(firstBuyAmount, minTokensOut, recipient);
        if (state.quoteSpent > firstBuyAmount) revert InvalidQuoteSpent(firstBuyAmount, state.quoteSpent);
        refund = firstBuyAmount - state.quoteSpent;

        _requireAllowance(state.quoteAsset, state.curve, 0);
        _requireBalance(state.quoteAsset, address(this), state.quoteBalanceBefore + refund);
        if (refund != 0) _transferQuoteExact(state.quoteAsset, creator, refund);
        _requireBalance(state.quoteAsset, address(this), state.quoteBalanceBefore);
        if (address(this).balance != state.nativeBalanceBefore) {
            revert NativeRefundBalanceMismatch(state.nativeBalanceBefore, address(this).balance);
        }
    }

    function _requireERC20Quote(bytes32 quoteAssetConfigId) internal view returns (address quoteAsset) {
        QuoteAssetConfig memory quote = _approvedQuoteRegistry.quoteConfig(quoteAssetConfigId);
        if (quote.status != CONFIG_STATUS_ACTIVE) {
            revert QuoteConfigNotActive(quoteAssetConfigId, quote.status);
        }
        quoteAsset = quote.quoteAsset;
        if (quoteAsset == address(0)) revert Erc20QuoteRequired(quoteAssetConfigId);
        if (quoteAsset.code.length == 0) revert InvalidLaunchRouterDependency(quoteAsset);
    }

    function _pullQuoteExact(address quoteAsset, address creator, uint256 amount, uint256 balanceBefore) private {
        _strictQuoteCall(quoteAsset, abi.encodeCall(IERC20.transferFrom, (creator, address(this), amount)));
        uint256 balanceAfter = _balanceOf(quoteAsset, address(this));
        uint256 received = balanceAfter >= balanceBefore ? balanceAfter - balanceBefore : type(uint256).max;
        if (received != amount) revert InexactQuoteBalanceDelta(quoteAsset, amount, received);
    }

    function _approveCurveExact(address quoteAsset, address curve, uint256 amount) internal {
        _requireAllowance(quoteAsset, curve, 0);
        _strictQuoteCall(quoteAsset, abi.encodeCall(IERC20.approve, (curve, amount)));
        _requireAllowance(quoteAsset, curve, amount);
    }

    function _transferQuoteExact(address quoteAsset, address creator, uint256 amount) internal {
        uint256 senderBefore = _balanceOf(quoteAsset, address(this));
        uint256 creatorBefore = _balanceOf(quoteAsset, creator);
        _strictQuoteCall(quoteAsset, abi.encodeCall(IERC20.transfer, (creator, amount)));
        uint256 senderAfter = _balanceOf(quoteAsset, address(this));
        uint256 creatorAfter = _balanceOf(quoteAsset, creator);
        uint256 debit = senderBefore >= senderAfter ? senderBefore - senderAfter : type(uint256).max;
        uint256 credit = creatorAfter >= creatorBefore ? creatorAfter - creatorBefore : type(uint256).max;
        if (debit != amount) revert InexactQuoteBalanceDelta(quoteAsset, amount, debit);
        if (credit != amount) revert InexactQuoteBalanceDelta(quoteAsset, amount, credit);
    }

    function _requireBalance(address quoteAsset, address account, uint256 expected) internal view {
        uint256 actual = _balanceOf(quoteAsset, account);
        if (actual != expected) revert InexactQuoteBalanceDelta(quoteAsset, expected, actual);
    }

    function _requireAllowance(address quoteAsset, address spender, uint256 expected) internal view {
        (bool success, bytes memory result) =
            quoteAsset.staticcall(abi.encodeCall(IERC20.allowance, (address(this), spender)));
        if (!success || result.length != 32) {
            revert InvalidQuoteAllowanceRead(quoteAsset, address(this), spender);
        }
        uint256 actual = abi.decode(result, (uint256));
        if (actual != expected) revert InexactQuoteAllowance(quoteAsset, spender, expected, actual);
    }

    function _balanceOf(address quoteAsset, address account) internal view returns (uint256 balance) {
        (bool success, bytes memory result) = quoteAsset.staticcall(abi.encodeCall(IERC20.balanceOf, (account)));
        if (!success || result.length != 32) revert InvalidQuoteBalanceRead(quoteAsset, account);
        balance = abi.decode(result, (uint256));
    }

    function _strictQuoteCall(address quoteAsset, bytes memory data) internal {
        (bool success, bytes memory result) = quoteAsset.call(data);
        if (!success) revert QuoteTransferCallFailed(quoteAsset);
        if (result.length != 32) revert InvalidQuoteTransferReturn(quoteAsset);
        uint256 returned;
        assembly ("memory-safe") {
            returned := mload(add(result, 32))
        }
        if (returned != 1) revert InvalidQuoteTransferReturn(quoteAsset);
    }
}
