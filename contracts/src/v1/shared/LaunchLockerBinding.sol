// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import {IMarketRegistryV1, MarketView} from "../interfaces/IV1Protocol.sol";

interface ILaunchLockerRegistryBinding {
    function graduationExecutor() external view returns (address);
}

interface ILaunchLockerPositionOwner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Immutable market, pool and prospective Position NFT binding shared by the final LaunchLocker.
/// @dev The token id is deliberately read during CREATE2 construction rather than included in init code. This keeps
///      the Factory-time predicted address stable while letting the graduation transaction bind the next real v4 NFT.
abstract contract LaunchLockerBinding {
    uint8 private constant LAUNCH_PHASE_SWEPT = 1;

    bytes32 private immutable _lockerMarketId;
    bytes32 private immutable _lockerPoolId;
    uint256 private immutable _lockerTokenId;

    IMarketRegistryV1 internal immutable _lockerMarketRegistry;
    IPositionManager internal immutable _lockerPositionManager;

    error InvalidLaunchLockerBinding(bytes32 marketId, address marketRegistry, address positionManager);
    error UnauthorizedLaunchLockerDeployer(address caller, address expectedExecutor);
    error LaunchLockerMarketNotSwept(bytes32 marketId, uint8 launchPhase);
    error InvalidProspectivePositionId(uint256 tokenId);
    error LockedPositionNotOwned(uint256 tokenId, address actualOwner);

    constructor(bytes32 marketId_, address marketRegistry_, address positionManager_) {
        if (
            marketId_ == bytes32(0) || marketRegistry_.code.length == 0 || positionManager_.code.length == 0
                || marketRegistry_ == positionManager_
        ) revert InvalidLaunchLockerBinding(marketId_, marketRegistry_, positionManager_);

        address expectedExecutor = ILaunchLockerRegistryBinding(marketRegistry_).graduationExecutor();
        if (msg.sender != expectedExecutor) revert UnauthorizedLaunchLockerDeployer(msg.sender, expectedExecutor);

        IMarketRegistryV1 registry = IMarketRegistryV1(marketRegistry_);
        MarketView memory value = registry.market(marketId_);
        if (value.runtime.launchPhase != LAUNCH_PHASE_SWEPT || value.runtime.poolId != bytes32(0)) {
            revert LaunchLockerMarketNotSwept(marketId_, value.runtime.launchPhase);
        }

        bytes32 poolId = registry.canonicalPoolId(marketId_);
        uint256 tokenId = IPositionManager(positionManager_).nextTokenId();
        if (poolId == bytes32(0) || tokenId == 0 || tokenId == type(uint256).max) {
            revert InvalidProspectivePositionId(tokenId);
        }

        _lockerMarketId = marketId_;
        _lockerPoolId = poolId;
        _lockerTokenId = tokenId;
        _lockerMarketRegistry = registry;
        _lockerPositionManager = IPositionManager(positionManager_);
    }

    function marketId() external view returns (bytes32) {
        return _lockerMarketId;
    }

    function lockedPosition() external view returns (uint256 tokenId, bytes32 poolId) {
        return (_lockerTokenId, _lockerPoolId);
    }

    function _lockedPositionIdentity() internal view returns (bytes32 marketId_, uint256 tokenId, bytes32 poolId) {
        return (_lockerMarketId, _lockerTokenId, _lockerPoolId);
    }

    /// @dev The concrete Locker calls this before every position mutation; the Executor also verifies immediately
    ///      after mint. A stolen or skipped prospective token id therefore fails the whole graduation transaction.
    function _requireLockedPositionOwnership() internal view returns (uint256 tokenId, bytes32 poolId) {
        tokenId = _lockerTokenId;
        poolId = _lockerPoolId;
        address actualOwner = address(0);
        try ILaunchLockerPositionOwner(address(_lockerPositionManager)).ownerOf(tokenId) returns (address owner) {
            actualOwner = owner;
        } catch {
            revert LockedPositionNotOwned(tokenId, address(0));
        }
        if (actualOwner != address(this)) revert LockedPositionNotOwned(tokenId, actualOwner);
    }
}
