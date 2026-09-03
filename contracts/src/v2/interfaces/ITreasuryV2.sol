// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

enum TreasuryEpochStatusV2 {
    UNREQUESTED,
    REQUESTED,
    ROOT_PENDING,
    CLAIMING,
    ROLLED_OVER
}

struct TreasuryMarketV2 {
    address memeToken;
    address quoteToken;
    bytes32 eligibilityPolicyHash;
    uint64 activatedAt;
}

struct RootServiceFeeV2 {
    address asset;
    uint128 amount;
}

struct TreasuryEpochV2 {
    uint64 requestedAt;
    uint64 publishBy;
    uint64 finalizeAfter;
    uint64 claimUntil;
    uint64 sourceBlockNumber;
    uint32 leafCount;
    TreasuryEpochStatusV2 status;
    address requester;
    address serviceFeeAsset;
    uint128 serviceFeeAmount;
    bytes32 sourceBlockHash;
    bytes32 merkleRoot;
    bytes32 datasetHash;
    uint256 quoteAmount;
    uint256 claimedAmount;
    uint256 totalTwab;
}

interface ITickerMemeTokenV2 is IERC20 {
    function marketId() external view returns (bytes32);
    function creator() external view returns (address);
    function factory() external view returns (address);
    function treasuryDistributor() external view returns (address);
    function metadataURI() external view returns (string memory);
    function initialSupply() external view returns (uint256);
    function deployedAt() external view returns (uint64);
    function burnTreasury(uint256 amount) external;
}

/// @notice Fee-routing-neutral integration seam for a future V2 fee policy.
/// @dev The caller supplies an idempotency key. No split or fee percentage is encoded here.
interface ITreasuryFundingV2 {
    function fundQuoteTreasury(bytes32 marketId, uint256 amount, bytes32 fundingId) external returns (uint32 epochId);

    function burnMeme(bytes32 marketId, uint256 amount, bytes32 burnId) external;
}

interface ITreasuryDistributorV2 is ITreasuryFundingV2 {
    event TreasuryMarketRegistered(
        bytes32 indexed marketId, address indexed memeToken, address indexed quoteToken, bytes32 eligibilityPolicyHash
    );
    event TreasuryMarketActivated(bytes32 indexed marketId, uint64 activatedAt);
    event RootServiceFeeUpdated(address indexed asset, uint128 amount);
    event QuoteTreasuryFunded(
        bytes32 indexed marketId,
        uint32 indexed epochId,
        address indexed funder,
        address quoteToken,
        bytes32 fundingId,
        uint256 amount
    );
    event MemeTreasuryBurned(
        bytes32 indexed marketId,
        address indexed funder,
        address indexed memeToken,
        bytes32 burnId,
        uint256 amount,
        uint256 totalSupplyAfter
    );
    event RootRequested(
        bytes32 indexed marketId,
        uint32 indexed epochId,
        address indexed requester,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 sourceBlockNumber,
        bytes32 sourceBlockHash,
        uint256 quoteAmount,
        address serviceFeeAsset,
        uint128 serviceFeeAmount,
        uint64 publishBy
    );
    event RootPublished(
        bytes32 indexed marketId,
        uint32 indexed epochId,
        bytes32 indexed merkleRoot,
        bytes32 datasetHash,
        uint256 totalTwab,
        uint32 leafCount,
        uint64 finalizeAfter
    );
    event PendingRootCancelled(bytes32 indexed marketId, uint32 indexed epochId, bytes32 indexed reasonHash);
    event RootFinalized(
        bytes32 indexed marketId, uint32 indexed epochId, bytes32 indexed merkleRoot, uint64 claimUntil
    );
    event RootRequestExpired(bytes32 indexed marketId, uint32 indexed epochId, address indexed requester);
    event TreasuryClaimed(
        bytes32 indexed marketId,
        uint32 indexed epochId,
        uint256 indexed leafIndex,
        address account,
        uint256 twab,
        uint256 amount
    );
    event EpochRemainderRolledOver(
        bytes32 indexed marketId, uint32 indexed fromEpochId, uint32 indexed toEpochId, uint256 amount
    );
    event ServiceCreditWithdrawn(address indexed asset, address indexed beneficiary, uint256 amount);

    function registerMarket(bytes32 marketId, address memeToken, address quoteToken, bytes32 eligibilityPolicyHash)
        external;

    function activateMarket(bytes32 marketId) external;
    function setRootServiceFee(address asset, uint128 amount) external;
    function requestRoot(bytes32 marketId, uint32 epochId) external payable;
    function publishRoot(
        bytes32 marketId,
        uint32 epochId,
        bytes32 merkleRoot,
        bytes32 datasetHash,
        uint256 totalTwab,
        uint32 leafCount,
        uint256 totalAllocated
    ) external;
    function cancelPendingRoot(bytes32 marketId, uint32 epochId, bytes32 reasonHash) external;
    function finalizeRoot(bytes32 marketId, uint32 epochId) external;
    function expireRootRequest(bytes32 marketId, uint32 epochId) external;
    function claim(
        bytes32 marketId,
        uint32 epochId,
        uint256 leafIndex,
        address account,
        uint256 twab,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external;
    function rolloverExpiredEpoch(bytes32 marketId, uint32 epochId) external returns (uint32 toEpochId, uint256 amount);
    function withdrawServiceCredit(address asset) external returns (uint256 amount);

    function market(bytes32 marketId) external view returns (TreasuryMarketV2 memory);
    function epoch(bytes32 marketId, uint32 epochId) external view returns (TreasuryEpochV2 memory);
    function rootServiceFee() external view returns (RootServiceFeeV2 memory);
    function epochWindow(bytes32 marketId, uint32 epochId) external view returns (uint64 start, uint64 end);
    function currentEpochId(bytes32 marketId) external view returns (uint32);
    function epochQuoteAmount(bytes32 marketId, uint32 epochId) external view returns (uint256);
    function serviceCredit(address asset, address beneficiary) external view returns (uint256);
    function totalQuoteLiability(address asset) external view returns (uint256);
    function totalServiceLiability(address asset) external view returns (uint256);
    function isClaimed(bytes32 marketId, uint32 epochId, uint256 leafIndex) external view returns (bool);
    function claimLeaf(
        bytes32 marketId,
        uint32 epochId,
        uint256 leafIndex,
        address account,
        uint256 twab,
        uint256 amount
    ) external view returns (bytes32);
}
