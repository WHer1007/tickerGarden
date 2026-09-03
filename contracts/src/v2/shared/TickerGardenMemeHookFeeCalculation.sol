// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {MarketView, PoolBinding, PoolKey, SwapParams} from "../interfaces/IV2Protocol.sol";
import {TickerGardenMemeHookLifecycle} from "./TickerGardenMemeHookLifecycle.sol";
import {V2MarketEconomics} from "./V2MarketEconomics.sol";

/// @notice Canonical unspecified-currency fee calculation and identity for the final v4 Hook.
abstract contract TickerGardenMemeHookFeeCalculation is TickerGardenMemeHookLifecycle {
    bytes32 private constant V4_FEE_DOMAIN = keccak256("TICKERGARDEN_V2_V4_FEE");
    uint256 private constant V4_FEE_SCHEMA_VERSION = 1;
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V2-EXEC-5");
    uint256 private constant FEE_PIPS_DENOMINATOR = 1_000_000;
    uint24 private constant FEE_PIPS = 10_000;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint16 private constant LP_SHARE_BPS = 2_000;
    uint64 private constant MAX_LIFETIME_FEE_CREDITS = type(uint48).max;
    uint24 private constant POOL_KEY_FEE = 0;
    uint8 private constant FEE_ASSET_MODE_UNSPECIFIED_CORE_SWAP_DELTA = 1;
    uint16 private constant STAKER_NON_LP_SHARE_BPS = 5_000;

    struct CalculatedV4Fee {
        bytes32 marketId;
        bytes32 poolId;
        address feeAsset;
        uint256 base;
        uint256 totalFee;
        uint256 lpAmount;
        uint256 nonLpAmount;
        uint32 sourceVersion;
        uint64 feeNonce;
        bytes32 feeId;
    }

    bytes32 internal immutable _hookFeePolicyHash;

    error InvalidSwapAmountSpecified(int256 amountSpecified);
    error FeeAmountTooLarge(uint256 amount);
    error FeeAssetNotCanonical(address feeAsset);
    error HookFeeNonceOverflow(bytes32 poolId);

    constructor(
        address marketRegistry_,
        address poolManager_,
        address protocolFeeVault_,
        address graduationExecutor_,
        address marketController_
    )
        TickerGardenMemeHookLifecycle(
            marketRegistry_, poolManager_, protocolFeeVault_, graduationExecutor_, marketController_
        )
    {
        _hookFeePolicyHash = V2MarketEconomics.hashFeePolicy(
            V2MarketEconomics.FeePolicyInput({
                executionSpecId: EXECUTION_SPEC_ID,
                feePips: FEE_PIPS,
                lpShareBps: LP_SHARE_BPS,
                poolKeyFee: POOL_KEY_FEE,
                hookPermissionMask: HOOK_PERMISSION_MASK,
                feeAssetMode: FEE_ASSET_MODE_UNSPECIFIED_CORE_SWAP_DELTA,
                stakerNonLpShareBps: STAKER_NON_LP_SHARE_BPS
            })
        );
    }

    function _prepareV4Fee(PoolKey calldata key, SwapParams calldata params, int256 coreDelta)
        internal
        returns (CalculatedV4Fee memory fee)
    {
        PoolBinding storage binding;
        MarketView memory value;
        (fee.poolId, binding, value) = _validateActivePool(key);
        fee.marketId = binding.marketId;
        fee.sourceVersion = binding.sourceVersion;
        (fee.feeAsset, fee.base) = _unspecifiedCurrencyAndBase(key, params, coreDelta, value);
        fee.totalFee = Math.mulDiv(fee.base, FEE_PIPS, FEE_PIPS_DENOMINATOR);
        if (fee.totalFee == 0) return fee;
        if (fee.totalFee > uint256(uint128(type(int128).max))) revert FeeAmountTooLarge(fee.totalFee);

        fee.lpAmount = Math.mulDiv(fee.totalFee, LP_SHARE_BPS, BPS_DENOMINATOR);
        fee.nonLpAmount = fee.totalFee - fee.lpAmount;
        if (binding.feeNonce >= MAX_LIFETIME_FEE_CREDITS) revert HookFeeNonceOverflow(fee.poolId);
        fee.feeNonce = binding.feeNonce + 1;
        binding.feeNonce = fee.feeNonce;
        fee.feeId = _v4FeeId(fee);
    }

    function _unspecifiedCurrencyAndBase(
        PoolKey calldata key,
        SwapParams calldata params,
        int256 coreDelta,
        MarketView memory value
    ) private pure returns (address feeAsset, uint256 base) {
        if (params.amountSpecified == 0) revert InvalidSwapAmountSpecified(params.amountSpecified);

        int128 amount0;
        int128 amount1;
        assembly ("memory-safe") {
            amount0 := sar(128, coreDelta)
            amount1 := signextend(15, coreDelta)
        }

        bool exactInput = params.amountSpecified < 0;
        int128 unspecifiedDelta;
        if (exactInput == params.zeroForOne) {
            feeAsset = key.currency1;
            unspecifiedDelta = amount1;
        } else {
            feeAsset = key.currency0;
            unspecifiedDelta = amount0;
        }
        if (feeAsset != value.config.quoteAsset && feeAsset != value.config.memeToken) {
            revert FeeAssetNotCanonical(feeAsset);
        }

        int256 widenedDelta = int256(unspecifiedDelta);
        base = widenedDelta < 0 ? uint256(-widenedDelta) : uint256(widenedDelta);
    }

    function _v4FeeId(CalculatedV4Fee memory fee) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                V4_FEE_DOMAIN,
                V4_FEE_SCHEMA_VERSION,
                block.chainid,
                _hookProtocolFeeVault,
                _hookPoolManager,
                fee.poolId,
                fee.marketId,
                fee.sourceVersion,
                fee.feeNonce,
                fee.feeAsset,
                fee.base,
                fee.totalFee,
                _hookFeePolicyHash
            )
        );
    }
}
