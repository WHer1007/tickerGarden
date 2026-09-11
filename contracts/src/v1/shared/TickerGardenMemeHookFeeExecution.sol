// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {ITickerGardenMemeHook, PoolKey, SwapParams} from "../interfaces/IV1Protocol.sol";
import {TickerGardenMemeHookFeeCalculation} from "./TickerGardenMemeHookFeeCalculation.sol";

interface IHookProtocolFeeVaultActions {
    function beginV4Credit(bytes32 marketId, address feeAsset, uint256 amount, uint32 sourceVersion, bytes32 feeId)
        external;
    function finalizeV4Credit(
        bytes32 marketId,
        address feeAsset,
        uint256 base,
        uint256 totalFee,
        uint256 lpAmount,
        uint256 nonLpAmount,
        uint64 feeNonce,
        bytes32 feeId
    ) external;
}

/// @notice Atomic exact-arrival FeeVault execution for the final v4 afterSwap path.
abstract contract TickerGardenMemeHookFeeExecution is TickerGardenMemeHookFeeCalculation {
    IPoolManager private immutable _hookPoolManagerActions;
    IHookProtocolFeeVaultActions private immutable _hookFeeVaultActions;

    error NonzeroCorePoolFee(bytes32 poolId, uint24 protocolFee, uint24 lpFee);

    constructor(address marketRegistry_, address poolManager_, address protocolFeeVault_, address graduationExecutor_)
        TickerGardenMemeHookFeeCalculation(marketRegistry_, poolManager_, protocolFeeVault_, graduationExecutor_)
    {
        _hookPoolManagerActions = IPoolManager(poolManager_);
        _hookFeeVaultActions = IHookProtocolFeeVaultActions(protocolFeeVault_);
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, int256 coreDelta, bytes calldata)
        external
        virtual
        override
        returns (bytes4 selector, int128 hookFeeDelta)
    {
        CalculatedV4Fee memory fee = _prepareV4Fee(key, params, coreDelta);
        _requireZeroLpFee(fee.poolId);
        selector = ITickerGardenMemeHook.afterSwap.selector;
        if (fee.totalFee == 0) return (selector, 0);

        _hookFeeVaultActions.beginV4Credit(fee.marketId, fee.feeAsset, fee.nonLpAmount, fee.sourceVersion, fee.feeId);
        _hookPoolManagerActions.take(Currency.wrap(fee.feeAsset), _hookProtocolFeeVault, fee.nonLpAmount);
        _hookFeeVaultActions.finalizeV4Credit(
            fee.marketId, fee.feeAsset, fee.base, fee.totalFee, fee.lpAmount, fee.nonLpAmount, fee.feeNonce, fee.feeId
        );

        emit V4FeeAccrued(
            fee.marketId,
            fee.poolId,
            fee.feeAsset,
            fee.feeNonce,
            fee.feeId,
            fee.base,
            fee.totalFee,
            fee.lpAmount,
            fee.nonLpAmount
        );
        hookFeeDelta = int128(uint128(fee.totalFee));
    }

    function _requireZeroLpFee(bytes32 poolId) private view {
        (,, uint24 protocolFee, uint24 lpFee) = StateLibrary.getSlot0(_hookPoolManagerActions, PoolId.wrap(poolId));
        // PoolManager collects its directional protocol fee separately from our Hook fee.
        if (lpFee != 0) revert NonzeroCorePoolFee(poolId, protocolFee, lpFee);
    }
}
