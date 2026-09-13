// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMemeStockGauge, MarketView} from "../interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultV4Accounting} from "./ProtocolFeeVaultV4Accounting.sol";

interface IFeeBurnToken {
    function burn(uint256 amount) external;
}

interface IUserHolderRewards {
    function fundMemeFees(bytes32 id, uint256 amount) external;
}

/// @notice Only the beneficiary chooses how their already-earned assets are paid.
abstract contract ProtocolFeeVaultUserClaims is ProtocolFeeVaultV4Accounting {
    using SafeERC20 for IERC20;
    error InvalidUserClaim();
    event MemeFeesBurned(bytes32 indexed marketId, address indexed beneficiary, uint8 indexed role, uint32 creatorEpoch, address token, uint256 amount);
    error RewardBalanceMismatch();

    error HolderSnapshotProofRequired();
    error InvalidHolderFundingBatch();
    error UnexpectedHolderFundingReturn();

    uint256 public constant MAX_HOLDER_FUNDING_BATCH = 32;
    uint256 public constant MIN_HOLDER_FUNDING_GAS = 100_000;
    uint256 public constant MAX_HOLDER_FUNDING_GAS = 2_000_000;
    uint256 public constant HOLDER_FUNDING_GAS_RESERVE = 80_000;

    /// @param asset Quote=1, Meme=2. Status: zero balance=0, settled (funded or burned)=1, reverted=2.
    /// @param errorSelector First four revert bytes only; zero also covers out-of-gas/empty revert.
    event HolderFundingResult(
        bytes32 indexed marketId, uint8 indexed asset, uint8 status, uint256 amount, bytes4 errorSelector
    );
    event HolderFundingBatchStopped(uint256 nextMarket, uint8 nextAsset);

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

    /// @param role 0 creator, 1 staker. Holder role 2 requires a direct distributor claimSnapshot proof.
    function claimUserRewards(bytes32 id, uint8 role, uint32 epoch)
        external
        returns (uint256 quotePaid, uint256 memePaid)
    {
        return _claimUserRewards(id, role, epoch, 3);
    }

    /// @notice Select earned Quote (1), Meme (2), or both (3). In burn mode every claim also settles all earned Meme fees by burning them.
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
        if (role == 2) revert HolderSnapshotProofRequired();
        _enterStandaloneOperation(bytes32("USER_CLAIM"));
        MarketView memory v = _feeMarketRegistry.market(id);
        _validateFeeMarket(id, v.config.memeToken, v);
        if (v.config.burnMemeFees) assets |= 2;
        if (assets & 1 != 0) _requireAssetSolvent(v.config.quoteAsset);
        if (assets & 2 != 0) _requireAssetSolvent(v.config.memeToken);
        (quotePaid, memePaid) = _consumeUserRewards(id, v, role, epoch, assets);
        if (quotePaid != 0) _payFeeAsset(v.config.quoteAsset, msg.sender, quotePaid);
        if (memePaid != 0) {
            if (v.config.burnMemeFees) {
                _burnMemeFees(id, v.config.memeToken, msg.sender, role, epoch, memePaid);
                memePaid = 0;
            } else _payFeeAsset(v.config.memeToken, msg.sender, memePaid);
        }
        // A malicious token payment can affect another asset: check both selected assets again.
        if (assets & 1 != 0) _requireAssetSolvent(v.config.quoteAsset);
        if (assets & 2 != 0) _requireAssetSolvent(v.config.memeToken);
        if (role < 2) {
            if (quotePaid != 0) emit FeeClaimed(role, msg.sender, id, epoch, v.config.quoteAsset, quotePaid);
            if (memePaid != 0) emit FeeClaimed(role, msg.sender, id, epoch, v.config.memeToken, memePaid);
        }
        emit UserRewardsClaimed(id, msg.sender, role, epoch, quotePaid, memePaid);
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
        }
        if (assets & 1 != 0) {
            _debitLiability(id, v.config.quoteAsset, role == 0 ? BUCKET_CREATOR_REVENUE : BUCKET_STAKER_REWARD, q);
        }
        if (assets & 2 != 0) {
            _debitLiability(id, v.config.memeToken, role == 0 ? BUCKET_CREATOR_REVENUE : BUCKET_STAKER_REWARD, m);
        }
    }

    /// @notice Permissionless best-effort funding; recipients and amounts come only from canonical accounting.
    /// @param assets Quote=1, Meme=2, both=3. Each selected asset has its own rollback boundary.
    /// @param gasPerAsset Bounded gas forwarded to each existing single-asset funding operation.
    /// @return nextMarket Input index at which low gas stopped the batch; length means all items attempted.
    /// @return nextAsset Asset to resume first (1 or 2), or zero on completion. Failed items need separate retries.
    function fundHolderRewardsBatch(bytes32[] calldata marketIds, uint8 assets, uint256 gasPerAsset)
        external
        returns (uint256 nextMarket, uint8 nextAsset)
    {
        uint256 length = marketIds.length;
        if (
            length == 0 || length > MAX_HOLDER_FUNDING_BATCH || assets == 0 || assets > 3
                || gasPerAsset < MIN_HOLDER_FUNDING_GAS || gasPerAsset > MAX_HOLDER_FUNDING_GAS
        ) {
            revert InvalidHolderFundingBatch();
        }
        // No external call occurs outside a self-call below. Each child holds the shared operation
        // guard for its entire funding path, so token/distributor callbacks cannot reenter this batch.
        _requireCreditIdle(bytes32("FUND_HOLDER_BATCH"));
        for (uint256 i; i < length; ++i) {
            for (uint8 asset = 1; asset <= 2; ++asset) {
                if (assets & asset == 0) continue;
                // EIP-150 forwarding margin plus reserve for the result event and graceful stop.
                if (gasleft() <= gasPerAsset + gasPerAsset / 63 + HOLDER_FUNDING_GAS_RESERVE) {
                    emit HolderFundingBatchStopped(i, asset);
                    return (i, asset);
                }
                _attemptHolderFunding(marketIds[i], asset, gasPerAsset);
            }
        }
        return (length, 0);
    }

    function _attemptHolderFunding(bytes32 id, uint8 asset, uint256 gasPerAsset) private {
        bytes memory payload = asset == 1
            ? abi.encodeWithSelector(this.fundHolderRewards.selector, id, uint32(1))
            : abi.encodeWithSelector(this.fundHolderMemeRewards.selector, id);
        bool success;
        uint256 result;
        uint256 size;
        // Fixed 32-byte output buffer: a malicious asset cannot force unbounded returndata copying
        // in the parent. All earlier changes inside a reverted child (including approvals) roll back.
        assembly ("memory-safe") {
            let output := mload(0x40)
            mstore(output, 0)
            success := call(gasPerAsset, address(), 0, add(payload, 32), mload(payload), output, 32)
            size := returndatasize()
            result := mload(output)
        }
        if (success) {
            // These are immutable local selectors returning exactly one uint256.
            if (size != 32) revert UnexpectedHolderFundingReturn();
            emit HolderFundingResult(id, asset, result == 0 ? 0 : 1, result, bytes4(0));
        } else {
            emit HolderFundingResult(id, asset, 2, 0, size >= 4 ? bytes4(bytes32(result)) : bytes4(0));
        }
    }

    function fundHolderMemeRewards(bytes32 id) external returns (uint256 amount) {
        _enterStandaloneOperation(bytes32("FUND_HOLDER_MEME"));
        MarketView memory v = _feeMarketRegistry.market(id);
        address distributor = _holderDistributor(v);
        address token = v.config.memeToken;
        if (v.config.burnMemeFees) {
            amount = _settleHolderMemeBurn(id, v);
            _exitStandaloneOperation();
            return amount;
        }
        amount = holderLiability[id][1][token];
        if (amount != 0) {
            _requireAssetSolvent(token);
            uint256 beforeBalance = _assetBalance(token);
            _debitHolderFee(id, 1, token, amount);
            IERC20(token).forceApprove(distributor, amount);
            IUserHolderRewards(distributor).fundMemeFees(id, amount);
            IERC20(token).forceApprove(distributor, 0);
            if (_assetBalance(token) + amount != beforeBalance) revert RewardBalanceMismatch();
        }
        _exitStandaloneOperation();
    }
    /// @dev Called under the shared operation guard. Never touches Platform liabilities.
    function _settleHolderMemeBurn(bytes32 id, MarketView memory v) internal override returns (uint256 amount) {
        if (!v.config.burnMemeFees) return 0;
        address token = v.config.memeToken;
        amount = holderLiability[id][1][token];
        if (amount == 0) return 0;
        _requireAssetSolvent(token);
        _debitHolderFee(id, 1, token, amount);
        _burnMemeFees(id, token, address(0), 2, 0, amount);
    }

    function _burnMemeFees(bytes32 id, address token, address beneficiary, uint8 role, uint32 epoch, uint256 amount) private {
        uint256 beforeBalance = _assetBalance(token);
        uint256 beforeSupply = IERC20(token).totalSupply();
        IFeeBurnToken(token).burn(amount);
        if (_assetBalance(token) + amount != beforeBalance || IERC20(token).totalSupply() + amount != beforeSupply) revert RewardBalanceMismatch();
        _requireAssetSolvent(token);
        emit MemeFeesBurned(id, beneficiary, role, epoch, token, amount);
    }

}
