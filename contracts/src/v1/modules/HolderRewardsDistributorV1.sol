// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAccessManager} from "@openzeppelin/contracts/access/manager/IAccessManager.sol";
import {AuthorityUtils} from "@openzeppelin/contracts/access/manager/AuthorityUtils.sol";
import {IMarketRegistryV1, ITickerMemeTokenV1, MarketView} from "../interfaces/IV1Protocol.sol";

import {CanonicalBlockClock} from "../libraries/CanonicalBlockClock.sol";

interface IHolderSnapshotHook {
    function poolManager() external view returns (address);
    function protocolFeeVault() external view returns (address);
}

interface IHolderSnapshotAuthority {
    function authority() external view returns (address);
}

/// @notice Fully funded wallet-balance snapshots, published by a restricted automation account.
/// @dev The publisher is trusted for historical balances and allocation correctness. A Merkle proof
///      proves inclusion, not correctness of the off-chain calculation. Token transfers never call here.
contract HolderRewardsDistributorV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant REWARD_MODE = keccak256("TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_V1");
    bytes32 public constant LEAF_DOMAIN = keccak256("TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_LEAF_V1");
    uint256 public constant MAX_PUBLISH_BATCH = 32;
    address public immutable marketRegistry;
    address public snapshotPublisher;

    struct Market {
        address token;
        address quote;
        address vault;
        uint64 registeredBlock;
        uint64 lastRound;
        uint64 lastSnapshotBlock;
        uint256 unallocatedQuote;
        uint256 unallocatedMeme;
        bool burnMemeFees;
    }

    struct Publication {
        bytes32 marketId;
        uint64 round;
        uint64 snapshotBlock;
        bytes32 snapshotBlockHash;
        bytes32 root;
        bytes32 dataHash;
        uint256 quoteBudget;
        uint256 memeBudget;
    }

    struct Round {
        bytes32 root;
        bytes32 snapshotBlockHash;
        bytes32 dataHash;
        uint64 snapshotBlock;
        uint256 quoteBudget;
        uint256 memeBudget;
        uint256 quoteRemaining;
        uint256 memeRemaining;
    }

    mapping(bytes32 => Market) private _markets;
    mapping(bytes32 => mapping(uint64 => Round)) private _rounds;
    mapping(bytes32 => mapping(uint64 => mapping(address => uint8))) public claimedAssets;
    mapping(bytes32 => mapping(address => bool)) public excluded;
    mapping(bytes32 => address[]) private _exclusions;
    mapping(address => uint256) public totalLiability;

    error InvalidMarket();
    error Unauthorized();
    error InvalidPublisher();
    error InvalidFunding();
    error InvalidPublication();
    error InvalidClaim();
    error AlreadyClaimed();
    error BudgetExceeded();
    error InexactTransfer();
    error TransferFailed();
    error Insolvent();

    event SnapshotPublisherChanged(address indexed previousPublisher, address indexed newPublisher);
    event HolderSnapshotMarketRegistered(bytes32 indexed marketId, address indexed token, address quote, address vault);
    event HolderAssetFunded(bytes32 indexed marketId, address indexed asset, uint256 amount);
    event HolderSnapshotPublished(
        bytes32 indexed marketId,
        uint64 indexed round,
        uint64 snapshotBlock,
        bytes32 snapshotBlockHash,
        bytes32 root,
        bytes32 dataHash,
        uint256 quoteBudget,
        uint256 memeBudget
    );
    event HolderSnapshotClaimed(
        bytes32 indexed marketId,
        uint64 indexed round,
        address indexed account,
        uint8 assets,
        uint256 quotePaid,
        uint256 memePaid
    );

    constructor(address registry) {
        if (registry.code.length == 0) revert InvalidMarket();
        marketRegistry = registry;
        // Deliberately unconfigured: a deployer is never implicitly a reward publisher.
    }

    function rewardMode() external pure returns (bytes32) {
        return REWARD_MODE;
    }

    /// @notice Governance configures/rotates the automation account; no per-round governance action is needed.
    function setSnapshotPublisher(address publisher) external nonReentrant {
        address stocks = IMarketRegistryV1(marketRegistry).officialStockRegistry();
        address authority = IHolderSnapshotAuthority(stocks).authority();
        (bool immediate,) = AuthorityUtils.canCallWithDelay(authority, msg.sender, address(this), msg.sig);
        if (!immediate) revert Unauthorized();
        if (publisher == address(0)) revert InvalidPublisher();
        emit SnapshotPublisherChanged(snapshotPublisher, publisher);
        snapshotPublisher = publisher;
    }

    /// @notice Guardian can revoke only the expected current publisher, including while the target is closed.
    /// @dev Existing roots/claims are unaffected; delayed governance alone can install a replacement.
    function revokeSnapshotPublisher(address expectedPublisher) external nonReentrant {
        address stocks = IMarketRegistryV1(marketRegistry).officialStockRegistry();
        address authority = IHolderSnapshotAuthority(stocks).authority();
        (bool guardian,) = IAccessManager(authority).hasRole(2, msg.sender);
        if (!guardian) revert Unauthorized();
        if (expectedPublisher == address(0) || snapshotPublisher != expectedPublisher) revert InvalidPublisher();
        snapshotPublisher = address(0);
        emit SnapshotPublisherChanged(expectedPublisher, address(0));
    }

    function registerFeeSharingMarket(bytes32 id, address vault, address locker) external nonReentrant {
        if (msg.sender != IMarketRegistryV1(marketRegistry).factory()) revert Unauthorized();
        MarketView memory v = IMarketRegistryV1(marketRegistry).market(id);
        address token = v.config.memeToken;
        uint256 height = CanonicalBlockClock.number();
        if (
            id == bytes32(0) || _markets[id].token != address(0) || token.code.length == 0
                || !v.config.creatorFeesToHolders || locker == address(0) || vault.code.length == 0
                || IHolderSnapshotHook(v.config.graduatedHook).protocolFeeVault() != vault
                || ITickerMemeTokenV1(token).marketId() != id
                || ITickerMemeTokenV1(token).holderRewardsDistributor() != address(this) || v.config.quoteAsset == token
                || height > type(uint64).max
        ) revert InvalidMarket();
        _markets[id] = Market(token, v.config.quoteAsset, vault, uint64(height), 0, 0, 0, 0, v.config.burnMemeFees);
        address[9] memory list = [
            address(0),
            address(0xdead),
            token,
            v.config.curve,
            IHolderSnapshotHook(v.config.graduatedHook).poolManager(),
            locker,
            address(this),
            vault,
            v.config.graduatedHook
        ];
        for (uint256 i; i < list.length; ++i) {
            if (excluded[id][list[i]]) continue;
            excluded[id][list[i]] = true;
            _exclusions[id].push(list[i]);
        }
        emit HolderSnapshotMarketRegistered(id, token, v.config.quoteAsset, vault);
    }

    function rewardBucket(bytes32 id) external view returns (uint32) {
        _market(id);
        return 1; // FeeVault's funding bucket, not a snapshot round.
    }

    function feeSharingVault(bytes32 id) external view returns (address) {
        return _markets[id].vault;
    }

    function feeSharingExcludedAccounts(bytes32 id) external view returns (address[] memory) {
        _market(id);
        return _exclusions[id];
    }

    function marketState(bytes32 id) external view returns (Market memory) {
        return _market(id);
    }

    function roundState(bytes32 id, uint64 round) external view returns (Round memory) {
        _market(id);
        return _rounds[id][round];
    }

    function fundQuoteRewards(bytes32 id, uint32 bucket, uint256 amount) external payable nonReentrant {
        Market storage m = _market(id);
        if (msg.sender != m.vault) revert Unauthorized();
        if (bucket != 1 || amount == 0) revert InvalidFunding();
        if (m.quote == address(0)) {
            if (msg.value != amount) revert InvalidFunding();
        } else {
            if (msg.value != 0) revert InvalidFunding();
            _receiveToken(m.quote, amount);
        }
        m.unallocatedQuote += amount;
        totalLiability[m.quote] += amount;
        _solvent(m.quote);
        emit HolderAssetFunded(id, m.quote, amount);
    }

    function fundMemeFees(bytes32 id, uint256 amount) external nonReentrant {
        Market storage m = _market(id);
        if (msg.sender != m.vault) revert Unauthorized();
        if (amount == 0 || m.burnMemeFees) revert InvalidFunding();
        _receiveToken(m.token, amount);
        m.unallocatedMeme += amount;
        totalLiability[m.token] += amount;
        _solvent(m.token);
        emit HolderAssetFunded(id, m.token, amount);
    }

    /// @notice Atomic bounded batch. Retry the identical payload after checking on-chain round identities.
    function publishSnapshots(Publication[] calldata publications) external nonReentrant {
        if (msg.sender != snapshotPublisher || snapshotPublisher == address(0)) revert Unauthorized();
        if (publications.length == 0 || publications.length > MAX_PUBLISH_BATCH) revert InvalidPublication();
        for (uint256 i; i < publications.length; ++i) {
            _publish(publications[i]);
        }
    }

    function _publish(Publication calldata p) private {
        Market storage m = _market(p.marketId);
        uint256 height = CanonicalBlockClock.number();
        if (m.burnMemeFees && p.memeBudget != 0) revert InvalidPublication();
        if (
            p.round == 0 || uint256(p.round) != uint256(m.lastRound) + 1 || p.snapshotBlock < m.registeredBlock
                || p.snapshotBlock <= m.lastSnapshotBlock || p.snapshotBlock >= height
                || p.snapshotBlockHash == bytes32(0) || p.root == bytes32(0) || p.dataHash == bytes32(0)
                || (p.quoteBudget == 0 && p.memeBudget == 0)
        ) revert InvalidPublication();
        // Recent block identities can be checked on-chain; older history remains publisher-attested.
        if (height - p.snapshotBlock <= 256) {
            bytes32 recentHash = CanonicalBlockClock.hash(p.snapshotBlock);
            if (recentHash == bytes32(0) || recentHash != p.snapshotBlockHash) revert InvalidPublication();
        }
        if (p.quoteBudget > m.unallocatedQuote || p.memeBudget > m.unallocatedMeme) revert BudgetExceeded();
        if (p.quoteBudget != 0) _solvent(m.quote);
        if (p.memeBudget != 0) _solvent(m.token);
        m.unallocatedQuote -= p.quoteBudget;
        m.unallocatedMeme -= p.memeBudget;
        m.lastRound = p.round;
        m.lastSnapshotBlock = p.snapshotBlock;
        _rounds[p.marketId][p.round] = Round(
            p.root,
            p.snapshotBlockHash,
            p.dataHash,
            p.snapshotBlock,
            p.quoteBudget,
            p.memeBudget,
            p.quoteBudget,
            p.memeBudget
        );
        emit HolderSnapshotPublished(
            p.marketId, p.round, p.snapshotBlock, p.snapshotBlockHash, p.root, p.dataHash, p.quoteBudget, p.memeBudget
        );
    }

    /// @notice Double-hashed leaves with sorted-pair Merkle proofs. No current-balance eligibility check.
    function claimLeaf(bytes32 id, uint64 round, address account, uint256 quoteAmount, uint256 memeAmount)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(LEAF_DOMAIN, block.chainid, address(this), id, round, account, quoteAmount, memeAmount)
                )
            )
        );
    }

    /// @param assets Quote=1, Meme=2, both=3. Unselected entitlement remains independently claimable.
    function claimSnapshot(
        bytes32 id,
        uint64 round,
        uint256 quoteAmount,
        uint256 memeAmount,
        uint8 assets,
        bytes32[] calldata proof
    ) external nonReentrant returns (uint256 quotePaid, uint256 memePaid) {
        if (assets == 0 || assets > 3 || excluded[id][msg.sender] || (quoteAmount == 0 && memeAmount == 0)) revert InvalidClaim();
        bytes32 leaf = claimLeaf(id, round, msg.sender, quoteAmount, memeAmount);
        if (!MerkleProof.verifyCalldata(proof, _rounds[id][round].root, leaf)) revert InvalidClaim();
        Market storage m = _market(id);
        if (m.burnMemeFees && memeAmount != 0) revert InvalidClaim();
        Round storage r = _rounds[id][round];
        if (r.root == bytes32(0)) revert InvalidClaim();
        if (claimedAssets[id][round][msg.sender] & assets != 0) revert AlreadyClaimed();
        quotePaid = assets & 1 != 0 ? quoteAmount : 0;
        memePaid = assets & 2 != 0 ? memeAmount : 0;
        if (quotePaid > r.quoteRemaining || memePaid > r.memeRemaining) revert BudgetExceeded();
        claimedAssets[id][round][msg.sender] |= assets;
        r.quoteRemaining -= quotePaid;
        r.memeRemaining -= memePaid;
        if (quotePaid != 0) _pay(m.quote, msg.sender, quotePaid);
        if (memePaid != 0) _pay(m.token, msg.sender, memePaid);
        // An asset callback may affect the other selected asset; check the final state as well.
        if (quotePaid != 0) _solvent(m.quote);
        if (memePaid != 0) _solvent(m.token);
        emit HolderSnapshotClaimed(id, round, msg.sender, assets, quotePaid, memePaid);
    }

    function _receiveToken(address asset, uint256 amount) private {
        uint256 beforeTo = IERC20(asset).balanceOf(address(this));
        uint256 beforeFrom = IERC20(asset).balanceOf(msg.sender);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        if (
            IERC20(asset).balanceOf(address(this)) != beforeTo + amount
                || IERC20(asset).balanceOf(msg.sender) + amount != beforeFrom
        ) revert InexactTransfer();
    }

    function _pay(address asset, address recipient, uint256 amount) private {
        _solvent(asset);
        totalLiability[asset] -= amount;
        if (asset == address(0)) {
            (bool ok,) = payable(recipient).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            uint256 beforeFrom = IERC20(asset).balanceOf(address(this));
            uint256 beforeTo = IERC20(asset).balanceOf(recipient);
            IERC20(asset).safeTransfer(recipient, amount);
            uint256 afterFrom = IERC20(asset).balanceOf(address(this));
            if (afterFrom + amount != beforeFrom || IERC20(asset).balanceOf(recipient) != beforeTo + amount) {
                revert InexactTransfer();
            }
            if (afterFrom < totalLiability[asset]) revert Insolvent();
        }
        // claimSnapshot checks final solvency after all selected-asset callbacks, including native payment.
    }

    function _solvent(address asset) private view {
        uint256 balance = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        if (balance < totalLiability[asset]) revert Insolvent();
    }

    function _market(bytes32 id) private view returns (Market storage m) {
        m = _markets[id];
        if (m.token == address(0)) revert InvalidMarket();
    }
}
