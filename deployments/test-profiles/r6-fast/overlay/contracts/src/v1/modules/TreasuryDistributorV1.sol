// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {
    IMarketRegistryV1,
    ITickerMemeTokenV1,
    ITreasuryDistributorV1,
    MarketView,
    RootServiceFeeV1,
    TreasuryEpochStatusV1,
    TreasuryEpochV1,
    TreasuryMarketV1
} from "../interfaces/IV1Protocol.sol";
import {CanonicalBlockClock} from "../libraries/CanonicalBlockClock.sol";
import {TreasuryClaimLeafV1} from "../libraries/TreasuryClaimLeafV1.sol";
import {ImmutableAccessManaged} from "../shared/ImmutableAccessManaged.sol";

interface IHolderSharingHook {
    function poolManager() external view returns (address);
    function protocolFeeVault() external view returns (address);
}

interface IHolderSharingFeeVault {
    function holderLiability(bytes32 marketId, uint32 epochId, address asset) external view returns (uint256);
}

struct TreasuryDistributorInitV1 {
    address authority;
    address marketRegistry;
    address rootServiceTreasury;
    address rootServiceFeeAsset;
    uint128 rootServiceFeeAmount;
    uint32 finalityDelaySeconds;
    uint16 finalityDelayBlocks;
    uint32 rootPublicationWindow;
    uint32 rootReviewDelay;
    uint32 claimWindow;
}

/// @notice Shared, market-isolated Quote treasury and attested TWAB Merkle distributor for V1.
/// @dev Fee percentages are deliberately outside this contract. Registration and activation are bound to the
///      canonical MarketRegistry; a market only becomes Treasury-active after its permanent pool is created.
contract TreasuryDistributorV1 is ITreasuryDistributorV1, ImmutableAccessManaged, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint32 public constant EPOCH_DURATION = 1 hours;
    bytes32 public constant EXECUTION_SPEC_ID = keccak256("V1-TREASURY-EXEC-1");
    bytes32 public constant TWAB_SCHEMA = keccak256("TRANSFER_LOG_TWAB_1H_R6_TEST_ONLY");
    bytes32 public constant CLAIM_LEAF_DOMAIN = keccak256("TICKERGARDEN_V1_TREASURY_CLAIM_V1");

    bytes32 private constant FUND_OPERATION_DOMAIN = keccak256("V1_TREASURY_FUND_QUOTE");
    bytes32 private constant BURN_OPERATION_DOMAIN = keccak256("V1_TREASURY_BURN_MEME");

    address public immutable override marketRegistry;
    address public immutable rootServiceTreasury;
    uint32 public immutable finalityDelaySeconds;
    uint16 public immutable finalityDelayBlocks;
    uint32 public immutable rootPublicationWindow;
    uint32 public immutable rootReviewDelay;
    uint32 public immutable claimWindow;

    RootServiceFeeV1 private _rootServiceFee;
    mapping(bytes32 => address) public override feeSharingVault;
    mapping(bytes32 => address[]) private _feeSharingExclusions;
    error InvalidFeeSharingCaller();
    error HolderFeesAwaitingSettlement();

    mapping(bytes32 marketId => TreasuryMarketV1 value) private _markets;
    mapping(bytes32 marketId => mapping(uint32 epochId => uint256 amount)) private _epochQuoteAmounts;
    mapping(bytes32 marketId => mapping(uint32 epochId => TreasuryEpochV1 value)) private _epochs;
    mapping(bytes32 marketId => mapping(uint32 epochId => mapping(uint256 wordIndex => uint256 bitmap))) private
        _claimedBitmaps;
    mapping(bytes32 marketId => mapping(uint32 epochId => mapping(address account => bool claimed))) private
        _accountClaims;
    mapping(address caller => mapping(bytes32 operationKey => bool consumed)) private _consumedOperations;
    mapping(address asset => mapping(address beneficiary => uint256 amount)) private _serviceCredits;
    mapping(address asset => uint256 amount) private _totalQuoteLiabilities;
    mapping(address asset => uint256 amount) private _totalServiceLiabilities;

    error InvalidConstructorConfig();
    error InvalidMarketId();
    error MarketAlreadyRegistered(bytes32 marketId);
    error MarketNotRegistered(bytes32 marketId);
    error MarketAlreadyActive(bytes32 marketId);
    error MarketNotActive(bytes32 marketId);
    error InvalidMemeToken(address token);
    error InvalidQuoteToken(address token);
    error InvalidCanonicalMarket(bytes32 marketId);
    error InvalidCanonicalLaunchPhase(bytes32 marketId, uint8 launchPhase);
    error InvalidEligibilityPolicy();
    error InvalidServiceFee(address asset, uint256 amount);
    error InvalidAmount();
    error InvalidOperationId();
    error OperationAlreadyConsumed(address caller, bytes32 operationId);
    error InvalidEpochId(uint32 epochId);
    error EpochNotClosed(uint64 readyAt);
    error EmptyEpoch(bytes32 marketId, uint32 epochId);
    error RootAlreadyRequested(bytes32 marketId, uint32 epochId, TreasuryEpochStatusV1 status);
    error RequesterIsNotHolder(address requester);
    error FinalityBlockUnavailable(uint256 blockNumber, uint16 delayBlocks);
    error IncorrectNativeServiceFee(uint256 supplied, uint256 required);
    error IncorrectNativeFunding(uint256 supplied, uint256 required);
    error UnexpectedNativeValue(uint256 supplied);
    error InvalidEpochStatus(TreasuryEpochStatusV1 current, TreasuryEpochStatusV1 required);
    error RootPublicationExpired(uint64 publishBy);
    error RootPublicationStillOpen(uint64 publishBy);
    error InvalidRootCommitment();
    error InvalidRootAllocation(uint256 supplied, uint256 required);
    error InvalidCancellationReason();
    error RootReviewPending(uint64 finalizeAfter);
    error ClaimWindowClosed(uint64 claimUntil);
    error InvalidClaim();
    error LeafIndexOutOfRange(uint256 leafIndex, uint32 leafCount);
    error ClaimAlreadyConsumed(uint256 leafIndex);
    error AccountAlreadyClaimed(address account);
    error InvalidMerkleProof();
    error ClaimExceedsEpoch(uint256 claimed, uint256 amount, uint256 epochAmount);
    error EpochStillClaimable(uint64 claimUntil);
    error InvalidRolloverEpoch(uint32 fromEpochId, uint32 toEpochId);
    error NoServiceCredit(address asset, address beneficiary);
    error NonExactTokenTransfer(address token, uint256 expected, uint256 actual);
    error NativeTransferFailed(address beneficiary, uint256 amount);
    error TreasuryInsolvent(address asset, uint256 balance, uint256 required);
    error TimestampOverflow(uint256 value);
    error EpochIdOverflow(uint256 value);

    constructor(TreasuryDistributorInitV1 memory init) ImmutableAccessManaged(init.authority) {
        if (
            init.marketRegistry == address(0) || init.marketRegistry.code.length == 0
                || init.rootServiceTreasury == address(0) || init.rootServiceTreasury == address(this)
                || init.rootServiceFeeAmount == 0 || init.finalityDelaySeconds == 0 || init.finalityDelayBlocks == 0
                || init.finalityDelayBlocks > 255 || init.rootPublicationWindow == 0 || init.rootReviewDelay == 0
                || init.claimWindow < EPOCH_DURATION
        ) revert InvalidConstructorConfig();
        if (init.rootServiceFeeAsset != address(0) && init.rootServiceFeeAsset.code.length == 0) {
            revert InvalidServiceFee(init.rootServiceFeeAsset, init.rootServiceFeeAmount);
        }

        marketRegistry = init.marketRegistry;
        rootServiceTreasury = init.rootServiceTreasury;
        finalityDelaySeconds = init.finalityDelaySeconds;
        finalityDelayBlocks = init.finalityDelayBlocks;
        rootPublicationWindow = init.rootPublicationWindow;
        rootReviewDelay = init.rootReviewDelay;
        claimWindow = init.claimWindow;
        _rootServiceFee = RootServiceFeeV1({asset: init.rootServiceFeeAsset, amount: init.rootServiceFeeAmount});
    }

    function registerMarket(bytes32 marketId, address memeToken, address quoteToken, bytes32 eligibilityPolicyHash)
        external
        override
        restricted
    {
        _registerMarket(marketId, memeToken, quoteToken, eligibilityPolicyHash);
    }

    function _registerMarket(bytes32 marketId, address memeToken, address quoteToken, bytes32 eligibilityPolicyHash)
        private
    {
        if (marketId == bytes32(0)) revert InvalidMarketId();
        if (_markets[marketId].memeToken != address(0)) revert MarketAlreadyRegistered(marketId);
        if (memeToken == address(0) || memeToken.code.length == 0) revert InvalidMemeToken(memeToken);
        if ((quoteToken != address(0) && quoteToken.code.length == 0) || quoteToken == memeToken) {
            revert InvalidQuoteToken(quoteToken);
        }
        if (eligibilityPolicyHash == bytes32(0)) revert InvalidEligibilityPolicy();

        MarketView memory canonical = _canonicalMarket(marketId);
        if (canonical.config.memeToken != memeToken || canonical.config.quoteAsset != quoteToken) {
            revert InvalidCanonicalMarket(marketId);
        }

        if (
            _readBytes32(memeToken, ITickerMemeTokenV1.marketId.selector) != marketId
                || _readAddress(memeToken, ITickerMemeTokenV1.treasuryDistributor.selector) != address(this)
                || _readUint256(memeToken, IERC20.totalSupply.selector) == 0
        ) revert InvalidMemeToken(memeToken);

        _markets[marketId] = TreasuryMarketV1({
            memeToken: memeToken, quoteToken: quoteToken, eligibilityPolicyHash: eligibilityPolicyHash, activatedAt: 0
        });
        emit TreasuryMarketRegistered(marketId, memeToken, quoteToken, eligibilityPolicyHash);
    }

    /// @notice Factory-only, immutable fee routing begins at creation, including curve fees.
    function registerFeeSharingMarket(bytes32 marketId, address feeVault, address locker) external override {
        if (msg.sender != IMarketRegistryV1(marketRegistry).factory()) revert InvalidFeeSharingCaller();
        MarketView memory canonical = _canonicalMarket(marketId);
        if (
            !canonical.config.creatorFeesToHolders || feeVault == address(0) || locker == address(0)
                || IHolderSharingHook(canonical.config.graduatedHook).protocolFeeVault() != feeVault
        ) revert InvalidFeeSharingCaller();
        address[] memory candidates = new address[](9);
        candidates[0] = address(0);
        candidates[1] = address(0xdead);
        candidates[2] = canonical.config.memeToken;
        candidates[3] = canonical.config.curve;
        candidates[4] = IHolderSharingHook(canonical.config.graduatedHook).poolManager();
        candidates[5] = locker;
        candidates[6] = address(this);
        candidates[7] = feeVault;
        candidates[8] = canonical.config.graduatedHook;
        for (uint256 i = 1; i < candidates.length; ++i) {
            address next = candidates[i];
            uint256 j = i;
            while (j > 0 && uint160(candidates[j - 1]) > uint160(next)) {
                candidates[j] = candidates[j - 1];
                --j;
            }
            candidates[j] = next;
        }
        for (uint256 i; i < candidates.length; ++i) {
            if (i == 0 || candidates[i] != candidates[i - 1]) _feeSharingExclusions[marketId].push(candidates[i]);
        }
        bytes32 policyHash = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_TREASURY_ELIGIBILITY_POLICY_V1"),
                block.chainid,
                marketId,
                _feeSharingExclusions[marketId]
            )
        );
        _registerMarket(marketId, canonical.config.memeToken, canonical.config.quoteAsset, policyHash);
        feeSharingVault[marketId] = feeVault;
        _markets[marketId].activatedAt = _timestamp();
        emit TreasuryMarketActivated(marketId, _markets[marketId].activatedAt);
    }

    function feeSharingExcludedAccounts(bytes32 marketId) external view override returns (address[] memory) {
        return _feeSharingExclusions[marketId];
    }

    /// @notice Only the bound FeeVault can fund a historical, still-unsealed fee epoch.
    function fundCreatorFees(bytes32 marketId, uint32 epochId, uint256 amount) external payable override nonReentrant {
        if (msg.sender != feeSharingVault[marketId] || msg.sender == address(0)) revert InvalidFeeSharingCaller();
        TreasuryMarketV1 storage value = _activeMarket(marketId);
        if (epochId == 0 || epochId > _currentEpochId(marketId, value)) revert InvalidEpochId(epochId);
        if (_epochs[marketId][epochId].status != TreasuryEpochStatusV1.UNREQUESTED) {
            revert InvalidEpochStatus(_epochs[marketId][epochId].status, TreasuryEpochStatusV1.UNREQUESTED);
        }
        if (amount == 0) revert InvalidAmount();
        if (value.quoteToken == address(0)) {
            if (msg.value != amount) revert IncorrectNativeFunding(msg.value, amount);
        } else {
            if (msg.value != 0) revert UnexpectedNativeValue(msg.value);
            _pullExact(value.quoteToken, msg.sender, amount);
        }
        _epochQuoteAmounts[marketId][epochId] += amount;
        _totalQuoteLiabilities[value.quoteToken] += amount;
        _assertSolvent(value.quoteToken);
        emit QuoteTreasuryFunded(
            marketId,
            epochId,
            msg.sender,
            value.quoteToken,
            keccak256(abi.encode(marketId, epochId, _epochQuoteAmounts[marketId][epochId])),
            amount
        );
    }

    /// @notice One-way activation seam after the canonical V1 pool has been created.
    function activateMarket(bytes32 marketId) external override {
        TreasuryMarketV1 storage value = _registeredMarket(marketId);
        if (value.activatedAt != 0) revert MarketAlreadyActive(marketId);
        MarketView memory canonical = _canonicalMarket(marketId);
        if (canonical.runtime.launchPhase != 1) {
            revert InvalidCanonicalLaunchPhase(marketId, canonical.runtime.launchPhase);
        }
        value.activatedAt = _timestamp();
        emit TreasuryMarketActivated(marketId, value.activatedAt);
    }

    function setRootServiceFee(address asset, uint128 amount) external override restricted {
        if (amount == 0 || (asset != address(0) && asset.code.length == 0)) {
            revert InvalidServiceFee(asset, amount);
        }
        _rootServiceFee = RootServiceFeeV1({asset: asset, amount: amount});
        emit RootServiceFeeUpdated(asset, amount);
    }

    function fundQuoteTreasury(bytes32 marketId, uint256 amount, bytes32 fundingId)
        external
        payable
        override
        nonReentrant
        returns (uint32 epochId)
    {
        TreasuryMarketV1 storage value = _activeMarket(marketId);
        if (amount == 0) revert InvalidAmount();
        _consumeOperation(FUND_OPERATION_DOMAIN, fundingId);

        epochId = _currentEpochId(marketId, value);
        if (value.quoteToken == address(0)) {
            if (msg.value != amount) revert IncorrectNativeFunding(msg.value, amount);
        } else {
            if (msg.value != 0) revert UnexpectedNativeValue(msg.value);
            _pullExact(value.quoteToken, msg.sender, amount);
        }
        _epochQuoteAmounts[marketId][epochId] += amount;
        _totalQuoteLiabilities[value.quoteToken] += amount;
        _assertSolvent(value.quoteToken);

        emit QuoteTreasuryFunded(marketId, epochId, msg.sender, value.quoteToken, fundingId, amount);
    }

    function burnMeme(bytes32 marketId, uint256 amount, bytes32 burnId) external override nonReentrant {
        TreasuryMarketV1 storage value = _activeMarket(marketId);
        if (amount == 0) revert InvalidAmount();
        _consumeOperation(BURN_OPERATION_DOMAIN, burnId);

        IERC20 token = IERC20(value.memeToken);
        uint256 treasuryBalanceBefore = token.balanceOf(address(this));
        uint256 supplyBefore = token.totalSupply();
        _pullExact(value.memeToken, msg.sender, amount);
        ITickerMemeTokenV1(value.memeToken).burnTreasury(amount);

        uint256 treasuryBalanceAfter = token.balanceOf(address(this));
        uint256 supplyAfter = token.totalSupply();
        if (treasuryBalanceAfter != treasuryBalanceBefore) {
            revert NonExactTokenTransfer(value.memeToken, treasuryBalanceBefore, treasuryBalanceAfter);
        }
        if (supplyBefore < amount || supplyAfter != supplyBefore - amount) {
            revert NonExactTokenTransfer(value.memeToken, supplyBefore - amount, supplyAfter);
        }
        _assertSolvent(value.memeToken);

        emit MemeTreasuryBurned(marketId, msg.sender, value.memeToken, burnId, amount, supplyAfter);
    }

    function _canonicalSourceBlock() private view returns (uint64 sourceBlockNumber, bytes32 sourceBlockHash) {
        uint256 currentBlockNumber = CanonicalBlockClock.number();
        if (currentBlockNumber <= finalityDelayBlocks || currentBlockNumber - finalityDelayBlocks > type(uint64).max) {
            revert FinalityBlockUnavailable(currentBlockNumber, finalityDelayBlocks);
        }
        sourceBlockNumber = uint64(currentBlockNumber - finalityDelayBlocks);
        sourceBlockHash = CanonicalBlockClock.hash(sourceBlockNumber);
        if (sourceBlockHash == bytes32(0)) revert FinalityBlockUnavailable(currentBlockNumber, finalityDelayBlocks);
    }

    function requestRoot(bytes32 marketId, uint32 epochId) external payable override nonReentrant {
        TreasuryMarketV1 storage value = _activeMarket(marketId);
        (uint64 windowStart, uint64 windowEnd) = _epochWindow(marketId, value, epochId);
        uint64 readyAt = _checkedTimestamp(uint256(windowEnd) + finalityDelaySeconds);
        if (block.timestamp < readyAt) revert EpochNotClosed(readyAt);

        address sharingVault = feeSharingVault[marketId];
        if (
            sharingVault != address(0)
                && (IHolderSharingFeeVault(sharingVault).holderLiability(marketId, epochId, value.quoteToken) != 0
                    || IHolderSharingFeeVault(sharingVault).holderLiability(marketId, epochId, value.memeToken) != 0)
        ) revert HolderFeesAwaitingSettlement();
        uint256 quoteAmount = _epochQuoteAmounts[marketId][epochId];
        if (quoteAmount == 0) revert EmptyEpoch(marketId, epochId);
        TreasuryEpochV1 storage valueEpoch = _epochs[marketId][epochId];
        if (valueEpoch.status != TreasuryEpochStatusV1.UNREQUESTED) {
            revert RootAlreadyRequested(marketId, epochId, valueEpoch.status);
        }
        // Historical holders may have sold and the remaining supply may be in system addresses.
        // After one publication window anyone can pay to trigger the same reviewed process.
        if (
            IERC20(value.memeToken).balanceOf(msg.sender) == 0
                && block.timestamp < uint256(readyAt) + rootPublicationWindow
        ) revert RequesterIsNotHolder(msg.sender);
        (uint64 sourceBlockNumber, bytes32 sourceBlockHash) = _canonicalSourceBlock();

        RootServiceFeeV1 memory fee = _rootServiceFee;
        _collectServiceFee(fee);
        uint64 requestedAt = _timestamp();
        uint64 publishBy = _checkedTimestamp(uint256(requestedAt) + rootPublicationWindow);

        valueEpoch.requestedAt = requestedAt;
        valueEpoch.publishBy = publishBy;
        valueEpoch.sourceBlockNumber = sourceBlockNumber;
        valueEpoch.status = TreasuryEpochStatusV1.REQUESTED;
        valueEpoch.requester = msg.sender;
        valueEpoch.serviceFeeAsset = fee.asset;
        valueEpoch.serviceFeeAmount = fee.amount;
        valueEpoch.sourceBlockHash = sourceBlockHash;
        valueEpoch.quoteAmount = quoteAmount;

        emit RootRequested(
            marketId,
            epochId,
            msg.sender,
            windowStart,
            windowEnd,
            sourceBlockNumber,
            sourceBlockHash,
            quoteAmount,
            fee.asset,
            fee.amount,
            publishBy
        );
    }

    function publishRoot(
        bytes32 marketId,
        uint32 epochId,
        bytes32 merkleRoot,
        bytes32 datasetHash,
        uint256 totalTwab,
        uint32 leafCount,
        uint256 totalAllocated
    ) external override nonReentrant restricted {
        TreasuryEpochV1 storage valueEpoch = _epochs[marketId][epochId];
        _requireEpochStatus(valueEpoch, TreasuryEpochStatusV1.REQUESTED);
        if (block.timestamp > valueEpoch.publishBy) revert RootPublicationExpired(valueEpoch.publishBy);
        bool emptyEpoch = totalTwab == 0 && leafCount == 0 && totalAllocated == 0;
        if (
            datasetHash == bytes32(0)
                || (emptyEpoch
                        ? merkleRoot != keccak256("TICKERGARDEN_V1_TREASURY_EMPTY_EPOCH_V1")
                        : merkleRoot == bytes32(0) || totalTwab == 0 || leafCount == 0)
        ) {
            revert InvalidRootCommitment();
        }
        if (!emptyEpoch && totalAllocated != valueEpoch.quoteAmount) {
            revert InvalidRootAllocation(totalAllocated, valueEpoch.quoteAmount);
        }

        uint64 finalizeAfter = _checkedTimestamp(block.timestamp + rootReviewDelay);
        valueEpoch.finalizeAfter = finalizeAfter;
        valueEpoch.leafCount = leafCount;
        valueEpoch.status = TreasuryEpochStatusV1.ROOT_PENDING;
        valueEpoch.merkleRoot = merkleRoot;
        valueEpoch.datasetHash = datasetHash;
        valueEpoch.totalTwab = totalTwab;

        emit RootPublished(marketId, epochId, merkleRoot, datasetHash, totalTwab, leafCount, finalizeAfter);
    }

    /// @dev This is an attested review cancellation, not a permissionless fraud proof.
    function cancelPendingRoot(bytes32 marketId, uint32 epochId, bytes32 reasonHash)
        external
        override
        nonReentrant
        restricted
    {
        if (reasonHash == bytes32(0)) revert InvalidCancellationReason();
        TreasuryEpochV1 storage valueEpoch = _epochs[marketId][epochId];
        _requireEpochStatus(valueEpoch, TreasuryEpochStatusV1.ROOT_PENDING);
        _refundAndReset(marketId, epochId, valueEpoch);
        emit PendingRootCancelled(marketId, epochId, reasonHash);
    }

    function finalizeRoot(bytes32 marketId, uint32 epochId) external override nonReentrant {
        TreasuryEpochV1 storage valueEpoch = _epochs[marketId][epochId];
        _requireEpochStatus(valueEpoch, TreasuryEpochStatusV1.ROOT_PENDING);
        if (block.timestamp < valueEpoch.finalizeAfter) revert RootReviewPending(valueEpoch.finalizeAfter);

        if (valueEpoch.totalTwab == 0 && valueEpoch.leafCount == 0) {
            TreasuryMarketV1 storage value = _activeMarket(marketId);
            uint32 toEpochId = _currentEpochId(marketId, value);
            if (toEpochId <= epochId) revert InvalidRolloverEpoch(epochId, toEpochId);
            uint256 amount = valueEpoch.quoteAmount;
            valueEpoch.status = TreasuryEpochStatusV1.ROLLED_OVER;
            _epochQuoteAmounts[marketId][epochId] = 0;
            _epochQuoteAmounts[marketId][toEpochId] += amount;
            _creditService(valueEpoch.serviceFeeAsset, rootServiceTreasury, valueEpoch.serviceFeeAmount);
            emit RootFinalized(marketId, epochId, valueEpoch.merkleRoot, 0);
            emit EpochRemainderRolledOver(marketId, epochId, toEpochId, amount);
            return;
        }
        valueEpoch.status = TreasuryEpochStatusV1.CLAIMING;
        valueEpoch.claimUntil = _checkedTimestamp(block.timestamp + claimWindow);
        _creditService(valueEpoch.serviceFeeAsset, rootServiceTreasury, valueEpoch.serviceFeeAmount);
        emit RootFinalized(marketId, epochId, valueEpoch.merkleRoot, valueEpoch.claimUntil);
    }

    function expireRootRequest(bytes32 marketId, uint32 epochId) external override nonReentrant {
        TreasuryEpochV1 storage valueEpoch = _epochs[marketId][epochId];
        _requireEpochStatus(valueEpoch, TreasuryEpochStatusV1.REQUESTED);
        if (block.timestamp <= valueEpoch.publishBy) revert RootPublicationStillOpen(valueEpoch.publishBy);
        address requester = valueEpoch.requester;
        _refundAndReset(marketId, epochId, valueEpoch);
        emit RootRequestExpired(marketId, epochId, requester);
    }

    function claim(
        bytes32 marketId,
        uint32 epochId,
        uint256 leafIndex,
        address account,
        uint256 twab,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external override nonReentrant {
        TreasuryMarketV1 storage value = _activeMarket(marketId);
        TreasuryEpochV1 storage valueEpoch = _epochs[marketId][epochId];
        _requireEpochStatus(valueEpoch, TreasuryEpochStatusV1.CLAIMING);
        if (block.timestamp > valueEpoch.claimUntil) revert ClaimWindowClosed(valueEpoch.claimUntil);
        if (account == address(0) || account == address(this) || twab == 0 || amount == 0) revert InvalidClaim();
        if (leafIndex >= valueEpoch.leafCount) revert LeafIndexOutOfRange(leafIndex, valueEpoch.leafCount);
        if (_isClaimed(marketId, epochId, leafIndex)) revert ClaimAlreadyConsumed(leafIndex);
        if (_accountClaims[marketId][epochId][account]) revert AccountAlreadyClaimed(account);

        bytes32 leaf = _claimLeaf(value, valueEpoch, marketId, epochId, leafIndex, account, twab, amount);
        if (!MerkleProof.verifyCalldata(merkleProof, valueEpoch.merkleRoot, leaf)) revert InvalidMerkleProof();

        uint256 nextClaimed = valueEpoch.claimedAmount + amount;
        if (nextClaimed > valueEpoch.quoteAmount) {
            revert ClaimExceedsEpoch(valueEpoch.claimedAmount, amount, valueEpoch.quoteAmount);
        }
        _setClaimed(marketId, epochId, leafIndex);
        _accountClaims[marketId][epochId][account] = true;
        valueEpoch.claimedAmount = nextClaimed;
        _totalQuoteLiabilities[value.quoteToken] -= amount;
        _payExact(value.quoteToken, account, amount);
        _assertSolvent(value.quoteToken);

        emit TreasuryClaimed(marketId, epochId, leafIndex, account, twab, amount);
    }

    function rolloverExpiredEpoch(bytes32 marketId, uint32 epochId)
        external
        override
        nonReentrant
        returns (uint32 toEpochId, uint256 amount)
    {
        TreasuryMarketV1 storage value = _activeMarket(marketId);
        TreasuryEpochV1 storage valueEpoch = _epochs[marketId][epochId];
        _requireEpochStatus(valueEpoch, TreasuryEpochStatusV1.CLAIMING);
        if (block.timestamp <= valueEpoch.claimUntil) revert EpochStillClaimable(valueEpoch.claimUntil);

        toEpochId = _currentEpochId(marketId, value);
        if (toEpochId <= epochId) revert InvalidRolloverEpoch(epochId, toEpochId);
        amount = valueEpoch.quoteAmount - valueEpoch.claimedAmount;
        valueEpoch.status = TreasuryEpochStatusV1.ROLLED_OVER;
        _epochQuoteAmounts[marketId][epochId] = 0;
        if (amount != 0) _epochQuoteAmounts[marketId][toEpochId] += amount;
        emit EpochRemainderRolledOver(marketId, epochId, toEpochId, amount);
    }

    function withdrawServiceCredit(address asset) external override nonReentrant returns (uint256 amount) {
        amount = _serviceCredits[asset][msg.sender];
        if (amount == 0) revert NoServiceCredit(asset, msg.sender);
        _serviceCredits[asset][msg.sender] = 0;
        _totalServiceLiabilities[asset] -= amount;
        if (asset == address(0)) {
            (bool success,) = msg.sender.call{value: amount}("");
            if (!success) revert NativeTransferFailed(msg.sender, amount);
        } else {
            _payExact(asset, msg.sender, amount);
        }
        _assertSolvent(asset);
        emit ServiceCreditWithdrawn(asset, msg.sender, amount);
    }

    function market(bytes32 marketId) external view override returns (TreasuryMarketV1 memory) {
        TreasuryMarketV1 storage value = _registeredMarket(marketId);
        return value;
    }

    function epoch(bytes32 marketId, uint32 epochId) external view override returns (TreasuryEpochV1 memory) {
        _registeredMarket(marketId);
        if (epochId == 0) revert InvalidEpochId(epochId);
        return _epochs[marketId][epochId];
    }

    function rootServiceFee() external view override returns (RootServiceFeeV1 memory) {
        return _rootServiceFee;
    }

    function epochWindow(bytes32 marketId, uint32 epochId) external view override returns (uint64 start, uint64 end) {
        return _epochWindow(marketId, _activeMarket(marketId), epochId);
    }

    function currentEpochId(bytes32 marketId) external view override returns (uint32) {
        return _currentEpochId(marketId, _activeMarket(marketId));
    }

    function epochQuoteAmount(bytes32 marketId, uint32 epochId) external view override returns (uint256) {
        _registeredMarket(marketId);
        if (epochId == 0) revert InvalidEpochId(epochId);
        return _epochQuoteAmounts[marketId][epochId];
    }

    function serviceCredit(address asset, address beneficiary) external view override returns (uint256) {
        return _serviceCredits[asset][beneficiary];
    }

    function totalQuoteLiability(address asset) external view override returns (uint256) {
        return _totalQuoteLiabilities[asset];
    }

    function totalServiceLiability(address asset) external view override returns (uint256) {
        return _totalServiceLiabilities[asset];
    }

    function isClaimed(bytes32 marketId, uint32 epochId, uint256 leafIndex) external view override returns (bool) {
        return _isClaimed(marketId, epochId, leafIndex);
    }

    function accountClaimed(bytes32 marketId, uint32 epochId, address account) external view returns (bool) {
        return _accountClaims[marketId][epochId][account];
    }

    function operationConsumed(address caller, bool memeBurn, bytes32 operationId) external view returns (bool) {
        bytes32 domain = memeBurn ? BURN_OPERATION_DOMAIN : FUND_OPERATION_DOMAIN;
        return _consumedOperations[caller][keccak256(abi.encode(domain, operationId))];
    }

    function claimLeaf(
        bytes32 marketId,
        uint32 epochId,
        uint256 leafIndex,
        address account,
        uint256 twab,
        uint256 amount
    ) external view override returns (bytes32) {
        TreasuryMarketV1 storage value = _activeMarket(marketId);
        TreasuryEpochV1 storage valueEpoch = _epochs[marketId][epochId];
        if (valueEpoch.sourceBlockHash == bytes32(0)) revert InvalidClaim();
        return _claimLeaf(value, valueEpoch, marketId, epochId, leafIndex, account, twab, amount);
    }

    function _claimLeaf(
        TreasuryMarketV1 storage value,
        TreasuryEpochV1 storage valueEpoch,
        bytes32 marketId,
        uint32 epochId,
        uint256 leafIndex,
        address account,
        uint256 twab,
        uint256 amount
    ) private view returns (bytes32) {
        (uint64 windowStart, uint64 windowEnd) = _epochWindow(marketId, value, epochId);
        TreasuryClaimLeafV1.Context memory context;
        context.chainId = block.chainid;
        context.distributor = address(this);
        context.marketId = marketId;
        context.epochId = epochId;
        context.memeToken = value.memeToken;
        context.quoteToken = value.quoteToken;
        context.eligibilityPolicyHash = value.eligibilityPolicyHash;
        context.windowStart = windowStart;
        context.windowEnd = windowEnd;
        context.sourceBlockNumber = valueEpoch.sourceBlockNumber;
        context.sourceBlockHash = valueEpoch.sourceBlockHash;
        return TreasuryClaimLeafV1.hash(context, leafIndex, account, twab, amount);
    }

    function _consumeOperation(bytes32 domain, bytes32 operationId) private {
        if (operationId == bytes32(0)) revert InvalidOperationId();
        bytes32 operationKey = keccak256(abi.encode(domain, operationId));
        if (_consumedOperations[msg.sender][operationKey]) {
            revert OperationAlreadyConsumed(msg.sender, operationId);
        }
        _consumedOperations[msg.sender][operationKey] = true;
    }

    function _collectServiceFee(RootServiceFeeV1 memory fee) private {
        if (fee.asset == address(0)) {
            if (msg.value != fee.amount) revert IncorrectNativeServiceFee(msg.value, fee.amount);
        } else {
            if (msg.value != 0) revert UnexpectedNativeValue(msg.value);
            _pullExact(fee.asset, msg.sender, fee.amount);
        }
        _totalServiceLiabilities[fee.asset] += fee.amount;
        _assertSolvent(fee.asset);
    }

    function _refundAndReset(bytes32 marketId, uint32 epochId, TreasuryEpochV1 storage valueEpoch) private {
        address requester = valueEpoch.requester;
        address feeAsset = valueEpoch.serviceFeeAsset;
        uint128 feeAmount = valueEpoch.serviceFeeAmount;
        delete _epochs[marketId][epochId];
        _creditService(feeAsset, requester, feeAmount);
    }

    function _creditService(address asset, address beneficiary, uint256 amount) private {
        _serviceCredits[asset][beneficiary] += amount;
    }

    function _pullExact(address token, address payer, uint256 amount) private {
        IERC20 asset = IERC20(token);
        uint256 balanceBefore = asset.balanceOf(address(this));
        asset.safeTransferFrom(payer, address(this), amount);
        uint256 balanceAfter = asset.balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert NonExactTokenTransfer(token, amount, balanceAfter < balanceBefore ? 0 : balanceAfter - balanceBefore);
        }
    }

    function _payExact(address token, address beneficiary, uint256 amount) private {
        if (token == address(0)) {
            (bool success,) = beneficiary.call{value: amount}("");
            if (!success) revert NativeTransferFailed(beneficiary, amount);
            return;
        }
        IERC20 asset = IERC20(token);
        uint256 treasuryBefore = asset.balanceOf(address(this));
        uint256 beneficiaryBefore = asset.balanceOf(beneficiary);
        asset.safeTransfer(beneficiary, amount);
        uint256 treasuryAfter = asset.balanceOf(address(this));
        uint256 beneficiaryAfter = asset.balanceOf(beneficiary);
        uint256 debit = treasuryAfter > treasuryBefore ? 0 : treasuryBefore - treasuryAfter;
        uint256 credit = beneficiaryAfter < beneficiaryBefore ? 0 : beneficiaryAfter - beneficiaryBefore;
        if (debit != amount) revert NonExactTokenTransfer(token, amount, debit);
        if (credit != amount) revert NonExactTokenTransfer(token, amount, credit);
    }

    function _assertSolvent(address asset) private view {
        uint256 required = _totalQuoteLiabilities[asset] + _totalServiceLiabilities[asset];
        uint256 balance = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        if (balance < required) revert TreasuryInsolvent(asset, balance, required);
    }

    function _setClaimed(bytes32 marketId, uint32 epochId, uint256 leafIndex) private {
        uint256 wordIndex = leafIndex >> 8;
        uint256 bitIndex = leafIndex & 255;
        _claimedBitmaps[marketId][epochId][wordIndex] |= 1 << bitIndex;
    }

    function _isClaimed(bytes32 marketId, uint32 epochId, uint256 leafIndex) private view returns (bool) {
        uint256 wordIndex = leafIndex >> 8;
        uint256 bitIndex = leafIndex & 255;
        return _claimedBitmaps[marketId][epochId][wordIndex] & (1 << bitIndex) != 0;
    }

    function _currentEpochId(bytes32 marketId, TreasuryMarketV1 storage value) private view returns (uint32 epochId) {
        if (value.activatedAt == 0) revert MarketNotActive(marketId);
        uint256 computed = (block.timestamp - value.activatedAt) / EPOCH_DURATION + 1;
        if (computed > type(uint32).max) revert EpochIdOverflow(computed);
        epochId = uint32(computed);
    }

    function _epochWindow(bytes32 marketId, TreasuryMarketV1 storage value, uint32 epochId)
        private
        view
        returns (uint64 start, uint64 end)
    {
        if (value.activatedAt == 0) revert MarketNotActive(marketId);
        if (epochId == 0) revert InvalidEpochId(epochId);
        uint256 computedStart = uint256(value.activatedAt) + uint256(epochId - 1) * EPOCH_DURATION;
        start = _checkedTimestamp(computedStart);
        end = _checkedTimestamp(computedStart + EPOCH_DURATION);
    }

    function _registeredMarket(bytes32 marketId) private view returns (TreasuryMarketV1 storage value) {
        value = _markets[marketId];
        if (value.memeToken == address(0)) revert MarketNotRegistered(marketId);
    }

    function _canonicalMarket(bytes32 marketId) private view returns (MarketView memory value) {
        try IMarketRegistryV1(marketRegistry).market(marketId) returns (MarketView memory canonical) {
            value = canonical;
        } catch {
            revert InvalidCanonicalMarket(marketId);
        }
    }

    function _activeMarket(bytes32 marketId) private view returns (TreasuryMarketV1 storage value) {
        value = _registeredMarket(marketId);
        if (value.activatedAt == 0) revert MarketNotActive(marketId);
    }

    function _requireEpochStatus(TreasuryEpochV1 storage value, TreasuryEpochStatusV1 required) private view {
        if (value.status != required) revert InvalidEpochStatus(value.status, required);
    }

    function _timestamp() private view returns (uint64) {
        return _checkedTimestamp(block.timestamp);
    }

    function _checkedTimestamp(uint256 value) private pure returns (uint64) {
        if (value == 0 || value > type(uint64).max) revert TimestampOverflow(value);
        return uint64(value);
    }

    function _readBytes32(address target, bytes4 selector) private view returns (bytes32 value) {
        (bool success, bytes memory data) = target.staticcall(abi.encodeWithSelector(selector));
        if (!success || data.length != 32) revert InvalidMemeToken(target);
        value = abi.decode(data, (bytes32));
    }

    function _readAddress(address target, bytes4 selector) private view returns (address value) {
        (bool success, bytes memory data) = target.staticcall(abi.encodeWithSelector(selector));
        if (!success || data.length != 32) revert InvalidMemeToken(target);
        value = abi.decode(data, (address));
    }

    function _readUint256(address target, bytes4 selector) private view returns (uint256 value) {
        (bool success, bytes memory data) = target.staticcall(abi.encodeWithSelector(selector));
        if (!success || data.length != 32) revert InvalidMemeToken(target);
        value = abi.decode(data, (uint256));
    }
}
