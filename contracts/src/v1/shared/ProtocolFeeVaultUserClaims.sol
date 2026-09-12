// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMemeStockGauge, MarketView} from "../interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultV4Accounting} from "./ProtocolFeeVaultV4Accounting.sol";

interface IUserHolderRewards {
    function consumeUserRewardAssets(bytes32 id, address user, uint8 assets)
        external
        returns (uint256 quote, uint256 meme);
    function fundMemeFees(bytes32 id, uint256 amount) external;
}

/// @notice Only the beneficiary chooses how their already-earned assets are paid.
abstract contract ProtocolFeeVaultUserClaims is ProtocolFeeVaultV4Accounting {
    using SafeERC20 for IERC20;
    error InvalidUserClaim();
    error RewardBalanceMismatch();

    bool private _userClaimActive;
    address private _claimHolderDistributor;

    event UserRewardsClaimed(
        bytes32 indexed marketId,
        address indexed user,
        uint8 indexed role,
        uint32 creatorEpoch,
        uint256 quotePaid,
        uint256 memePaid
    );

    constructor(address registry, address manager, address creators, address treasury, bytes32 policy)
        ProtocolFeeVaultV4Accounting(registry, manager, creators, treasury, policy)
    {}

    function userClaimMode() external pure returns (bytes32) {
        return keccak256("TICKERGARDEN_USER_CLAIM_RAW_ASSETS_V1");
    }

    /// @param role 0 creator, 1 staker, 2 holder. Assets are paid directly to the beneficiary.
    function claimUserRewards(bytes32 id, uint8 role, uint32 epoch)
        external
        returns (uint256 quotePaid, uint256 memePaid)
    {
        return _claimUserRewards(id, role, epoch, 3);
    }

    /// @notice Select earned Quote (1), Meme (2), or both (3). Unselected rights remain untouched.
    function claimUserRewardAssets(bytes32 id, uint8 role, uint32 epoch, uint8 assets)
        external
        returns (uint256 quotePaid, uint256 memePaid)
    {
        return _claimUserRewards(id, role, epoch, assets);
    }

    function _claimUserRewards(bytes32 id, uint8 role, uint32 epoch, uint8 assets)
        private
        returns (uint256 quotePaid, uint256 memePaid)
    {
        if (assets == 0 || assets > 3 || role > 2 || (role != 0 && epoch != 0)) revert InvalidUserClaim();
        _enterStandaloneOperation(bytes32("USER_CLAIM"));
        _userClaimActive = true;
        MarketView memory v = _feeMarketRegistry.market(id);
        _validateFeeMarket(id, v.config.memeToken, v);
        if (assets & 1 != 0) _requireAssetSolvent(v.config.quoteAsset);
        if (assets & 2 != 0) _requireAssetSolvent(v.config.memeToken);
        (quotePaid, memePaid) = _consumeUserRewards(id, v, role, epoch, assets);
        if (quotePaid != 0) _payFeeAsset(v.config.quoteAsset, msg.sender, quotePaid);
        if (memePaid != 0) _payFeeAsset(v.config.memeToken, msg.sender, memePaid);
        // A malicious token payment can affect another asset: check both selected assets again.
        if (assets & 1 != 0) _requireAssetSolvent(v.config.quoteAsset);
        if (assets & 2 != 0) _requireAssetSolvent(v.config.memeToken);
        if (role < 2) {
            if (quotePaid != 0) emit FeeClaimed(role, msg.sender, id, epoch, v.config.quoteAsset, quotePaid);
            if (memePaid != 0) emit FeeClaimed(role, msg.sender, id, epoch, v.config.memeToken, memePaid);
        }
        emit UserRewardsClaimed(id, msg.sender, role, epoch, quotePaid, memePaid);
        _userClaimActive = false;
        _exitStandaloneOperation();
    }

    function _consumeUserRewards(bytes32 id, MarketView memory v, uint8 role, uint32 epoch, uint8 assets)
        private
        returns (uint256 q, uint256 m)
    {
        if (role == 0) {
            if (epoch == 0 || _feeCreatorRevenueRegistry.creatorBeneficiaryAt(id, epoch) != msg.sender) {
                revert InvalidUserClaim();
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
            if (!v.config.stakingEnabled) revert InvalidUserClaim();
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
                revert RewardBalanceMismatch();
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
            if (_assetBalance(token) + amount != beforeBalance) revert RewardBalanceMismatch();
        }
        _exitStandaloneOperation();
    }

    function _isRewardSettlementPayment() internal view virtual override returns (bool) {
        // Holder distributor only returns canonical earned Quote during the protected claim.
        return (_userClaimActive && msg.sender == _claimHolderDistributor) || super._isRewardSettlementPayment();
    }
}
