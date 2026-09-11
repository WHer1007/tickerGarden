// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMemeStockGauge, MarketView} from "../interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultUserConversion, IUserRewardGauge} from "./ProtocolFeeVaultUserConversion.sol";

interface IUserHolderRewards {
    function consumeUserRewardAssets(bytes32 id, address user, uint8 assets)
        external
        returns (uint256 quote, uint256 meme);
    function restoreUserMeme(bytes32 id, address user, uint256 amount) external;
    function fundMemeFees(bytes32 id, uint256 amount) external;
}

/// @notice Only the beneficiary chooses how their already-earned assets are paid.
abstract contract ProtocolFeeVaultUserClaims is ProtocolFeeVaultUserConversion {
    using SafeERC20 for IERC20;
    bool private _userClaimActive;
    address private _claimHolderDistributor;

    struct ClaimResult {
        uint256 q;
        uint256 m;
        uint256 spent;
        uint256 received;
        uint256 quotePaid;
        uint256 memePaid;
        uint256 retained;
        bool failed;
    }
    event UserRewardsClaimed(
        bytes32 indexed marketId,
        address indexed user,
        uint8 indexed role,
        uint32 creatorEpoch,
        uint256 quotePaid,
        uint256 memePaid,
        uint256 memeRetained,
        uint256 memeConverted,
        bool conversionFailed
    );

    constructor(address registry, address manager, address creators, address treasury, bytes32 policy)
        ProtocolFeeVaultUserConversion(registry, manager, creators, treasury, policy)
    {}

    function userClaimMode() external pure returns (bytes32) {
        return keccak256("TICKERGARDEN_USER_CLAIM_ASSET_SELECTION_V1");
    }

    /// @param role 0 creator, 1 staker, 2 holder. Quote already earned is paid regardless of a failed swap.
    function claimUserRewards(bytes32 id, uint8 role, uint32 epoch, bool convert, bool rawFallback, uint256 deadline)
        external
        returns (uint256 quotePaid, uint256 memePaid, uint256 memeRetained)
    {
        return _claimUserRewards(id, role, epoch, 3, convert, rawFallback, deadline);
    }

    /// @notice Select earned Quote (1), Meme (2), or both (3). Unselected rights remain untouched.
    function claimUserRewardAssets(
        bytes32 id,
        uint8 role,
        uint32 epoch,
        uint8 assets,
        bool convert,
        bool rawFallback,
        uint256 deadline
    ) external returns (uint256 quotePaid, uint256 memePaid, uint256 memeRetained) {
        return _claimUserRewards(id, role, epoch, assets, convert, rawFallback, deadline);
    }

    function _claimUserRewards(
        bytes32 id,
        uint8 role,
        uint32 epoch,
        uint8 assets,
        bool convert,
        bool rawFallback,
        uint256 deadline
    ) private returns (uint256 quotePaid, uint256 memePaid, uint256 memeRetained) {
        if (assets == 0 || assets > 3 || role > 2 || (role != 0 && epoch != 0)) {
            revert InvalidConversion();
        }
        _enterStandaloneOperation(bytes32("USER_CLAIM"));
        _userClaimActive = true;
        MarketView memory v = _feeMarketRegistry.market(id);
        _validateFeeMarket(id, v.config.memeToken, v);
        if (assets & 1 != 0) _requireAssetSolvent(v.config.quoteAsset);
        if (assets & 2 != 0) _requireAssetSolvent(v.config.memeToken);
        ClaimResult memory r;
        (r.q, r.m) = _consumeUserRewards(id, v, role, epoch, assets);
        if (convert && r.m != 0) {
            try this.convertUserClaim(id, v, r.m, deadline) returns (uint256 used, uint256 output) {
                r.spent = used;
                r.received = output;
            } catch {
                r.failed = true;
            }
        }
        uint256 remaining = r.m - r.spent;
        r.quotePaid = r.q + r.received;
        if (!convert || rawFallback) {
            r.memePaid = remaining;
        } else {
            r.retained = remaining;
            _restoreUserMeme(id, v, role, epoch, remaining);
        }
        if (r.quotePaid != 0) _payFeeAsset(v.config.quoteAsset, msg.sender, r.quotePaid);
        if (r.memePaid != 0) _payFeeAsset(v.config.memeToken, msg.sender, r.memePaid);
        if (assets & 1 != 0) _requireAssetSolvent(v.config.quoteAsset);
        if (assets & 2 != 0) _requireAssetSolvent(v.config.memeToken);
        if (role < 2) {
            if (r.spent != 0) emit RewardConverted(id, msg.sender, epoch, r.spent, r.received);
            if (r.quotePaid != 0) emit FeeClaimed(role, msg.sender, id, epoch, v.config.quoteAsset, r.quotePaid);
            if (r.memePaid != 0) emit FeeClaimed(role, msg.sender, id, epoch, v.config.memeToken, r.memePaid);
        }
        emit UserRewardsClaimed(id, msg.sender, role, epoch, r.quotePaid, r.memePaid, r.retained, r.spent, r.failed);
        _userClaimActive = false;
        _exitStandaloneOperation();
        return (r.quotePaid, r.memePaid, r.retained);
    }

    function convertUserClaim(bytes32 id, MarketView calldata v, uint256 amount, uint256 deadline)
        external
        returns (uint256 spent, uint256 received)
    {
        if (msg.sender != address(this) || !_userClaimActive) revert InvalidConversion();
        if (deadline < block.timestamp || deadline > block.timestamp + 5 minutes) revert InvalidConversion();
        if (v.runtime.launchPhase != 1) revert InvalidConversion();
        return _convertOwnedRewards(id, v, amount, deadline);
    }

    function _consumeUserRewards(bytes32 id, MarketView memory v, uint8 role, uint32 epoch, uint8 assets)
        private
        returns (uint256 q, uint256 m)
    {
        if (role == 0) {
            if (epoch == 0 || _feeCreatorRevenueRegistry.creatorBeneficiaryAt(id, epoch) != msg.sender) {
                revert InvalidConversion();
            }
            if (assets & 1 != 0) {
                q = _creatorLiabilities[id][epoch][v.config.quoteAsset];
                delete _creatorLiabilities[id][epoch][v.config.quoteAsset];
            }
            if (assets & 2 != 0) {
                m = _creatorLiabilities[id][epoch][v.config.memeToken];
                delete _creatorLiabilities[id][epoch][v.config.memeToken];
            }
        } else if (role == 1) {
            if (!v.config.stakingEnabled) revert InvalidConversion();
            // One authorization/lock check and settlement, with independent asset debits.
            (q, m) = IMemeStockGauge(v.config.gauge).consumeClaimableAssets(msg.sender, assets);
        } else {
            uint256 qb = assets & 1 != 0 ? _assetBalance(v.config.quoteAsset) : 0;
            uint256 mb = assets & 2 != 0 ? _assetBalance(v.config.memeToken) : 0;
            _claimHolderDistributor = _holderDistributor(v);
            (q, m) = IUserHolderRewards(_claimHolderDistributor).consumeUserRewardAssets(id, msg.sender, assets);
            _claimHolderDistributor = address(0);
            if (
                (assets & 1 != 0 && _assetBalance(v.config.quoteAsset) != qb + q)
                    || (assets & 2 != 0 && _assetBalance(v.config.memeToken) != mb + m)
            ) {
                revert ConversionBalanceMismatch();
            }
            return (q, m);
        }
        if (assets & 1 != 0) {
            _debitLiability(id, v.config.quoteAsset, role == 0 ? BUCKET_CREATOR_REVENUE : BUCKET_STAKER_REWARD, q);
        }
        if (assets & 2 != 0) {
            _debitLiability(id, v.config.memeToken, role == 0 ? BUCKET_CREATOR_REVENUE : BUCKET_STAKER_REWARD, m);
        }
    }

    function _restoreUserMeme(bytes32 id, MarketView memory v, uint8 role, uint32 epoch, uint256 amount) private {
        if (amount == 0) return;
        if (role == 2) {
            address distributor = _holderDistributor(v);
            uint256 beforeBalance = _assetBalance(v.config.memeToken);
            IERC20(v.config.memeToken).forceApprove(distributor, amount);
            IUserHolderRewards(distributor).restoreUserMeme(id, msg.sender, amount);
            IERC20(v.config.memeToken).forceApprove(distributor, 0);
            if (_assetBalance(v.config.memeToken) + amount != beforeBalance) revert ConversionBalanceMismatch();
        } else {
            if (role == 1) IUserRewardGauge(v.config.gauge).restoreUserMemeRewards(msg.sender, amount);
            uint32 e = role == 0 ? epoch : _feeCreatorRevenueRegistry.currentCreatorEpoch(id);
            _creditFeeLiabilities(id, e, v.config.memeToken, amount, role == 0 ? amount : 0, role == 1 ? amount : 0, 0);
        }
    }

    function fundHolderMemeRewards(bytes32 id) external returns (uint256 amount) {
        _enterStandaloneOperation(bytes32("FUND_HOLDER_MEME"));
        MarketView memory v = _feeMarketRegistry.market(id);
        address distributor = _holderDistributor(v);
        address token = v.config.memeToken;
        _requireAssetSolvent(token);
        amount = holderLiability[id][1][token];
        if (amount != 0) {
            uint256 beforeBalance = _assetBalance(token);
            _debitHolderFee(id, 1, token, amount);
            IERC20(token).forceApprove(distributor, amount);
            IUserHolderRewards(distributor).fundMemeFees(id, amount);
            IERC20(token).forceApprove(distributor, 0);
            if (_assetBalance(token) + amount != beforeBalance) revert ConversionBalanceMismatch();
        }
        _exitStandaloneOperation();
    }

    function _isRewardSettlementPayment() internal view virtual override returns (bool) {
        // Holder distributor only returns canonical earned Quote during the protected claim.
        return (_userClaimActive && msg.sender == _claimHolderDistributor) || super._isRewardSettlementPayment();
    }
}
