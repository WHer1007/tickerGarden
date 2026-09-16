// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessManager} from "@openzeppelin/contracts/access/manager/IAccessManager.sol";

import {ProtocolFeeVaultUserClaims} from "../shared/ProtocolFeeVaultUserClaims.sol";

struct ProtocolFeeVaultInit {
    address authority;
    address marketRegistry;
    address poolManager;
    address creatorRevenueRegistry;
    address platformTreasury;
    bytes32 feePolicyId;
}

/// @notice Canonical V1 fee-accounting and liability vault.
contract ProtocolFeeVault is ProtocolFeeVaultUserClaims {
    // Membership is checked directly. This dedicated state timelock replaces (not adds to)
    // AccessManager's scheduled-execution delay for Treasury changes only.
    uint256 public constant TREASURY_CHANGE_DELAY = 48 hours;
    uint64 private constant PROTOCOL_ADMIN_ROLE = 1;
    uint64 private constant PAUSE_GUARDIAN_ROLE = 2;
    address public immutable authority;
    uint256 public treasuryProposalNonce;
    address public pendingPlatformTreasury;
    address public treasuryProposer;
    uint256 public treasuryChangeReadyAt;
    bool public treasuryChangeAccepted;
    bytes32 public pendingTreasuryCodeHash;

    error InvalidTreasuryAuthority(address authority);
    error UnauthorizedTreasuryActor(address caller);
    error TreasuryProposalPending();
    error InvalidTreasuryProposal(uint256 nonce);
    error TreasuryChangeNotReady();
    error TreasuryCodeChanged(address treasury);

    event PlatformTreasuryProposed(
        uint256 indexed nonce,
        address indexed oldTreasury,
        address indexed newTreasury,
        address proposer,
        uint256 readyAt,
        bytes32 codeHash
    );
    event PlatformTreasuryAccepted(uint256 indexed nonce, address indexed newTreasury);
    event PlatformTreasuryCancelled(uint256 indexed nonce, address indexed caller);
    event PlatformTreasuryChanged(uint256 indexed nonce, address indexed oldTreasury, address indexed newTreasury);

    modifier treasuryOperation() {
        _enterStandaloneOperation(bytes32("TREASURY_CHANGE"));
        _;
        _exitStandaloneOperation();
    }

    constructor(ProtocolFeeVaultInit memory init)
        ProtocolFeeVaultUserClaims(
            init.marketRegistry, init.poolManager, init.creatorRevenueRegistry, init.platformTreasury, init.feePolicyId
        )
    {
        if (init.authority.code.length == 0 || init.authority == address(this)) {
            revert InvalidTreasuryAuthority(init.authority);
        }
        authority = init.authority;
    }

    function proposePlatformTreasury(address nextTreasury) external treasuryOperation {
        _requireTreasuryRole(msg.sender, false);
        if (pendingPlatformTreasury != address(0)) revert TreasuryProposalPending();
        _validateNextTreasury(nextTreasury);
        uint256 nonce = ++treasuryProposalNonce;
        pendingPlatformTreasury = nextTreasury;
        treasuryProposer = msg.sender;
        treasuryChangeReadyAt = block.timestamp + TREASURY_CHANGE_DELAY;
        pendingTreasuryCodeHash = nextTreasury.codehash;
        emit PlatformTreasuryProposed(
            nonce, _feePlatformTreasury, nextTreasury, msg.sender, treasuryChangeReadyAt, pendingTreasuryCodeHash
        );
    }

    function acceptPlatformTreasury(uint256 nonce) external treasuryOperation {
        _requireTreasuryProposal(nonce);
        if (msg.sender != pendingPlatformTreasury) revert UnauthorizedTreasuryActor(msg.sender);
        if (msg.sender.codehash != pendingTreasuryCodeHash) revert TreasuryCodeChanged(msg.sender);
        treasuryChangeAccepted = true;
        emit PlatformTreasuryAccepted(nonce, msg.sender);
    }

    function cancelPlatformTreasury(uint256 nonce) external treasuryOperation {
        _requireTreasuryRole(msg.sender, true);
        _requireTreasuryProposal(nonce);
        _clearTreasuryProposal();
        emit PlatformTreasuryCancelled(nonce, msg.sender);
    }

    function executePlatformTreasury(uint256 nonce) external treasuryOperation {
        _requireTreasuryProposal(nonce);
        if (!treasuryChangeAccepted || block.timestamp < treasuryChangeReadyAt) revert TreasuryChangeNotReady();
        _requireTreasuryRole(treasuryProposer, false);
        address nextTreasury = pendingPlatformTreasury;
        _validateNextTreasury(nextTreasury);
        if (nextTreasury.codehash != pendingTreasuryCodeHash) revert TreasuryCodeChanged(nextTreasury);
        address previousTreasury = _feePlatformTreasury;
        _clearTreasuryProposal();
        _feePlatformTreasury = nextTreasury;
        emit PlatformTreasuryChanged(nonce, previousTreasury, nextTreasury);
    }

    function _requireTreasuryRole(address actor, bool allowGuardian) private view {
        (bool admin,) = IAccessManager(authority).hasRole(PROTOCOL_ADMIN_ROLE, actor);
        if (admin) return;
        if (allowGuardian) {
            (bool guardian,) = IAccessManager(authority).hasRole(PAUSE_GUARDIAN_ROLE, actor);
            if (guardian) return;
        }
        revert UnauthorizedTreasuryActor(actor);
    }

    function _requireTreasuryProposal(uint256 nonce) private view {
        if (pendingPlatformTreasury == address(0) || nonce != treasuryProposalNonce) {
            revert InvalidTreasuryProposal(nonce);
        }
    }

    function _validateNextTreasury(address nextTreasury) private view {
        if (
            nextTreasury.code.length == 0 || nextTreasury == _feePlatformTreasury || nextTreasury == address(this)
                || nextTreasury == authority || nextTreasury == address(_feeMarketRegistry)
                || nextTreasury == _feePoolManager || nextTreasury == address(_feeCreatorRevenueRegistry)
        ) {
            revert InvalidPlatformTreasury(nextTreasury);
        }
    }

    function _clearTreasuryProposal() private {
        delete pendingPlatformTreasury;
        delete treasuryProposer;
        delete treasuryChangeReadyAt;
        delete treasuryChangeAccepted;
        delete pendingTreasuryCodeHash;
    }

    function marketRegistry() external view returns (address) {
        return address(_feeMarketRegistry);
    }

    function poolManager() external view returns (address) {
        return _feePoolManager;
    }

    function creatorRevenueRegistry() external view returns (address) {
        return address(_feeCreatorRevenueRegistry);
    }

    function platformTreasury() external view returns (address) {
        return _feePlatformTreasury;
    }

    function feePolicyId() external view returns (bytes32) {
        return _feePolicyIdValue();
    }

    function feePolicyHash() external view returns (bytes32) {
        return _v4FeePolicyHash();
    }
}
