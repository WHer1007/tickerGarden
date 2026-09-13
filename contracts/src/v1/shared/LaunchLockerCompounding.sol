// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PositionInfo} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LaunchLockerCustody} from "./LaunchLockerCustody.sol";
import {MarketView} from "../interfaces/IV1Protocol.sol";

interface ILockerCompoundExecutor {
    function compoundKeeper() external view returns (address);
}

interface ILockerPermit2 {
    function permit2() external view returns (IAllowanceTransfer);
}

/// @notice Fees can only increase the permanently bound position; principal and donations cannot be spent.
abstract contract LaunchLockerCompounding is LaunchLockerCustody, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 private _compoundFees0;
    uint256 private _compoundFees1;
    uint256 private _isolated0;
    uint256 private _isolated1;

    struct CompoundBefore {
        uint256 balance0;
        uint256 balance1;
        uint128 liquidity;
    }

    error UnauthorizedCompoundKeeper();
    error InvalidCompoundPlan();
    error InvalidCompoundPosition();
    error CompoundBalanceMismatch();

    event LockedFeesCollected(bytes32 indexed marketId, uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event LockedFeesCompounded(
        bytes32 indexed marketId,
        uint256 indexed tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1,
        uint256 remaining0,
        uint256 remaining1
    );

    constructor(bytes32 id, address registry, address manager) LaunchLockerCustody(id, registry, manager) {}

    function pendingCompoundFees() external view returns (uint256 amount0, uint256 amount1) {
        return (_compoundFees0, _compoundFees1);
    }

    /// @notice Anyone may realize fees into this Locker. No principal is removed and nobody receives payment.
    function collectLockedFees() external nonReentrant returns (uint256 amount0, uint256 amount1) {
        (uint256 tokenId, V4PoolKey memory key, PositionInfo info) = _position();
        return _collect(tokenId, key, info);
    }

    /// @notice Keeper supplies a freshly priced, bounded plan. No swap or caller-selected destination is supported.
    function compoundLockedFees(uint128 liquidity, uint128 amount0Max, uint128 amount1Max, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        if (msg.sender != ILockerCompoundExecutor(_lockerMarketRegistry.graduationExecutor()).compoundKeeper()) {
            revert UnauthorizedCompoundKeeper();
        }
        if (liquidity == 0 || deadline < block.timestamp || deadline > block.timestamp + 5 minutes) {
            revert InvalidCompoundPlan();
        }
        (uint256 tokenId, V4PoolKey memory key, PositionInfo info) = _position();
        _collect(tokenId, key, info);
        _isolateManagerBalances(key);
        _requireFeeCoverage();
        if (amount0Max > _compoundFees0 || amount1Max > _compoundFees1) revert InvalidCompoundPlan();
        CompoundBefore memory beforeState = CompoundBefore(
            unpairedLockedBalance(_lockerCurrency0),
            unpairedLockedBalance(_lockerCurrency1),
            _lockerPositionManager.getPositionLiquidity(tokenId)
        );
        {
            IAllowanceTransfer permit = ILockerPermit2(address(_lockerPositionManager)).permit2();
            _approve(permit, _lockerCurrency0, amount0Max);
            _approve(permit, _lockerCurrency1, amount1Max);
            bytes[] memory params = new bytes[](4);
            params[0] = abi.encode(tokenId, uint256(liquidity), amount0Max, amount1Max, bytes(""));
            params[1] = abi.encode(key.currency0, key.currency1);
            params[2] = abi.encode(key.currency0, address(this));
            params[3] = abi.encode(key.currency1, address(this));
            _lockerPositionManager.modifyLiquidities{value: _lockerCurrency0 == address(0) ? amount0Max : 0}(
                abi.encode(
                    abi.encodePacked(
                        uint8(Actions.INCREASE_LIQUIDITY),
                        uint8(Actions.SETTLE_PAIR),
                        uint8(Actions.SWEEP),
                        uint8(Actions.SWEEP)
                    ),
                    params
                ),
                deadline
            );
            _revoke(permit, _lockerCurrency0);
            _revoke(permit, _lockerCurrency1);
        }
        uint256 after0 = unpairedLockedBalance(_lockerCurrency0);
        uint256 after1 = unpairedLockedBalance(_lockerCurrency1);
        if (after0 > beforeState.balance0 || after1 > beforeState.balance1) revert CompoundBalanceMismatch();
        amount0 = beforeState.balance0 - after0;
        amount1 = beforeState.balance1 - after1;
        if (
            amount0 > amount0Max || amount1 > amount1Max
                || _lockerPositionManager.getPositionLiquidity(tokenId) != uint256(beforeState.liquidity) + liquidity
        ) revert CompoundBalanceMismatch();
        _compoundFees0 -= amount0;
        _compoundFees1 -= amount1;
        _checkPositionUnchanged(key, info);
        _requireFeeCoverage();
        (bytes32 id,,) = _lockedPositionIdentity();
        emit LockedFeesCompounded(id, tokenId, liquidity, amount0, amount1, _compoundFees0, _compoundFees1);
    }

    function _collect(uint256 tokenId, V4PoolKey memory key, PositionInfo info)
        private
        returns (uint256 amount0, uint256 amount1)
    {
        uint256 before0 = unpairedLockedBalance(_lockerCurrency0);
        uint256 before1 = unpairedLockedBalance(_lockerCurrency1);
        // Never reduce an established isolation floor after an external balance loss.
        uint256 deficit0;
        uint256 deficit1;
        (_isolated0, deficit0) = _observeCoverage(before0, _compoundFees0, _isolated0);
        (_isolated1, deficit1) = _observeCoverage(before1, _compoundFees1, _isolated1);
        uint128 liquidity = _lockerPositionManager.getPositionLiquidity(tokenId);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, address(this));
        _lockerPositionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR)), params),
            block.timestamp
        );
        uint256 after0 = unpairedLockedBalance(_lockerCurrency0);
        uint256 after1 = unpairedLockedBalance(_lockerCurrency1);
        if (after0 < before0 || after1 < before1 || _lockerPositionManager.getPositionLiquidity(tokenId) != liquidity) {
            revert CompoundBalanceMismatch();
        }
        amount0 = after0 - before0;
        amount1 = after1 - before1;
        // New fees first restore historical coverage; only excess creates new fee spending capacity.
        _compoundFees0 += amount0 > deficit0 ? amount0 - deficit0 : 0;
        _compoundFees1 += amount1 > deficit1 ? amount1 - deficit1 : 0;
        _checkPositionUnchanged(key, info);
        (bytes32 id,,) = _lockedPositionIdentity();
        emit LockedFeesCollected(id, tokenId, amount0, amount1);
    }

    function _observeCoverage(uint256 balance, uint256 fees, uint256 isolated)
        private
        pure
        returns (uint256 nextIsolated, uint256 deficit)
    {
        uint256 required = fees + isolated;
        if (balance < required) return (isolated, required - balance);
        return (balance - fees, 0);
    }

    /// @dev PositionManager SWEEP includes unrelated balances. Clear them before sending any native
    ///      spending budget, in the same guarded Locker transaction, and isolate every received unit.
    function _isolateManagerBalances(V4PoolKey memory key) private {
        uint256 before0 = unpairedLockedBalance(_lockerCurrency0);
        uint256 before1 = unpairedLockedBalance(_lockerCurrency1);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key.currency0, address(this));
        params[1] = abi.encode(key.currency1, address(this));
        _lockerPositionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.SWEEP), uint8(Actions.SWEEP)), params), block.timestamp
        );
        uint256 after0 = unpairedLockedBalance(_lockerCurrency0);
        uint256 after1 = unpairedLockedBalance(_lockerCurrency1);
        if (after0 < before0 || after1 < before1) revert CompoundBalanceMismatch();
        _isolated0 += after0 - before0;
        _isolated1 += after1 - before1;
    }

    function _position() private view returns (uint256 tokenId, V4PoolKey memory key, PositionInfo info) {
        bytes32 poolId;
        (tokenId, poolId) = _requireLockedPositionOwnership();
        (bytes32 id,,) = _lockedPositionIdentity();
        MarketView memory value = _lockerMarketRegistry.market(id);
        if (value.runtime.launchPhase != 1 || value.runtime.poolId != poolId) revert InvalidCompoundPosition();
        (key, info) = _lockerPositionManager.getPoolAndPositionInfo(tokenId);
        if (
            keccak256(abi.encode(key)) != poolId || Currency.unwrap(key.currency0) != _lockerCurrency0
                || Currency.unwrap(key.currency1) != _lockerCurrency1
        ) revert InvalidCompoundPosition();
    }

    function _checkPositionUnchanged(V4PoolKey memory key, PositionInfo info) private view {
        (, V4PoolKey memory afterKey, PositionInfo afterInfo) = _position();
        if (
            keccak256(abi.encode(afterKey)) != keccak256(abi.encode(key))
                || PositionInfo.unwrap(afterInfo) != PositionInfo.unwrap(info)
        ) revert InvalidCompoundPosition();
    }

    function _requireFeeCoverage() private view {
        if (
            unpairedLockedBalance(_lockerCurrency0) < _compoundFees0 + _isolated0
                || unpairedLockedBalance(_lockerCurrency1) < _compoundFees1 + _isolated1
        ) revert CompoundBalanceMismatch();
    }

    function _approve(IAllowanceTransfer permit, address asset, uint128 amount) private {
        if (asset == address(0)) return;
        IERC20(asset).forceApprove(address(permit), amount);
        permit.approve(asset, address(_lockerPositionManager), uint160(amount), uint48(block.timestamp));
    }

    function _revoke(IAllowanceTransfer permit, address asset) private {
        if (asset == address(0)) return;
        permit.approve(asset, address(_lockerPositionManager), 0, 0);
        IERC20(asset).forceApprove(address(permit), 0);
    }
}
