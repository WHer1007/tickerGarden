// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {ITickerGardenMemeHook, PoolKey, SwapParams} from "../interfaces/IV2Protocol.sol";
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

/// @notice Atomic LP donation and exact-arrival FeeVault execution for the final v4 afterSwap path.
abstract contract TickerGardenMemeHookFeeExecution is TickerGardenMemeHookFeeCalculation {
    IPoolManager private immutable _hookPoolManagerActions;
    IHookProtocolFeeVaultActions private immutable _hookFeeVaultActions;

    error NonzeroCorePoolFee(bytes32 poolId, uint24 protocolFee, uint24 lpFee);

    constructor(
        address marketRegistry_,
        address poolManager_,
        address protocolFeeVault_,
        address graduationExecutor_,
        address marketController_
    )
        TickerGardenMemeHookFeeCalculation(
            marketRegistry_, poolManager_, protocolFeeVault_, graduationExecutor_, marketController_
        )
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
        _requireZeroCorePoolFees(fee.poolId);
        selector = ITickerGardenMemeHook.afterSwap.selector;
        if (fee.totalFee == 0) return (selector, 0);

        _hookFeeVaultActions.beginV4Credit(fee.marketId, fee.feeAsset, fee.nonLpAmount, fee.sourceVersion, fee.feeId);
        if (fee.lpAmount != 0) {
            (uint256 amount0, uint256 amount1) =
                fee.feeAsset == key.currency0 ? (fee.lpAmount, uint256(0)) : (uint256(0), fee.lpAmount);
            _hookPoolManagerActions.donate(_v4PoolKey(key), amount0, amount1, "");
        }
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

    function _requireZeroCorePoolFees(bytes32 poolId) private view {
        (,, uint24 protocolFee, uint24 lpFee) = StateLibrary.getSlot0(_hookPoolManagerActions, PoolId.wrap(poolId));
        if (protocolFee != 0 || lpFee != 0) revert NonzeroCorePoolFee(poolId, protocolFee, lpFee);
    }

    function _v4PoolKey(PoolKey calldata key) private pure returns (V4PoolKey memory) {
        return V4PoolKey({
            currency0: Currency.wrap(key.currency0),
            currency1: Currency.wrap(key.currency1),
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: IHooks(key.hooks)
        });
    }
}
