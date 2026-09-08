// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMarketRegistryV1, ITickerMemeTokenV1, MarketView} from "../interfaces/IV1Protocol.sol";
import {IContinuousRewardToken} from "../interfaces/IContinuousHolderRewards.sol";

interface IContinuousRewardsHook {
    function poolManager() external view returns (address);
    function protocolFeeVault() external view returns (address);
}

/// @notice Fully funded, market-isolated holder rewards streamed over exactly 24 hours per funding.
/// @dev No holder iteration, historical logs, root publisher or expiry of already-earned rewards.
///      A bounded FIFO holds independent streams; a new funding never postpones an existing stream.
contract HolderRewardsDistributorV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant STREAM_DURATION = 24 hours;
    uint256 public constant MAX_STREAMS = 64;
    uint256 public constant PRECISION = 1e27;
    bytes32 public constant REWARD_MODE = keccak256("TICKERGARDEN_HOLDER_STREAM_24H_V1");
    address public immutable marketRegistry;

    struct Stream { uint64 end; uint256 rate; uint256 remainder; }
    struct Market {
        address token;
        address quote;
        address vault;
        uint64 updatedAt;
        uint8 head;
        uint8 count;
        uint256 supply;
        uint256 index;
        uint256 indexRemainder;
        uint256 rate;
        uint256 idle;
        uint256 funded;
        uint256 paid;
    }
    struct Account { uint256 index; uint256 earnedScaled; }

    mapping(bytes32 => Market) private _markets;
    mapping(bytes32 => mapping(uint256 => Stream)) private _streams;
    mapping(bytes32 => mapping(address => Account)) private _accounts;
    mapping(bytes32 => mapping(address => bool)) public excluded;
    mapping(bytes32 => address[]) private _exclusions;
    mapping(address => uint256) public totalLiability;
    mapping(bytes32 => uint64) public lastFundingAt;

    error InvalidMarket();
    error Unauthorized();
    error InvalidFunding();
    error StreamCapacity();
    error InexactTransfer();
    error TransferFailed();
    error Insolvent();
    event HolderStreamMarketRegistered(bytes32 indexed marketId, address indexed token, address quote, address vault);
    event HolderStreamFunded(bytes32 indexed marketId, uint256 amount, uint64 end);
    event HolderStreamClaimed(bytes32 indexed marketId, address indexed account, address asset, uint256 amount);
    event IdleRewardsRestarted(bytes32 indexed marketId, uint256 scaledAmount, uint64 end);

    constructor(address registry) {
        if (registry.code.length == 0) revert InvalidMarket();
        marketRegistry = registry;
    }

    function rewardMode() external pure returns (bytes32) { return REWARD_MODE; }

    function registerFeeSharingMarket(bytes32 id, address vault, address locker) external nonReentrant {
        if (msg.sender != IMarketRegistryV1(marketRegistry).factory()) revert Unauthorized();
        MarketView memory v = IMarketRegistryV1(marketRegistry).market(id);
        address token = v.config.memeToken;
        if (id == bytes32(0) || _markets[id].token != address(0) || token.code.length == 0
            || !v.config.creatorFeesToHolders || locker == address(0) || vault.code.length == 0
            || IContinuousRewardsHook(v.config.graduatedHook).protocolFeeVault() != vault
            || ITickerMemeTokenV1(token).marketId() != id
            || ITickerMemeTokenV1(token).treasuryDistributor() != address(this)
            || v.config.quoteAsset == token) revert InvalidMarket();
        Market storage m = _markets[id];
        m.token = token; m.quote = v.config.quoteAsset; m.vault = vault; m.updatedAt = _now();
        address[9] memory list = [address(0), address(0xdead), token, v.config.curve,
            IContinuousRewardsHook(v.config.graduatedHook).poolManager(), locker, address(this), vault,
            v.config.graduatedHook];
        m.supply = IERC20(token).totalSupply();
        for (uint256 i; i < list.length; ++i) {
            if (excluded[id][list[i]]) continue;
            excluded[id][list[i]] = true;
            _exclusions[id].push(list[i]);
            m.supply -= IERC20(token).balanceOf(list[i]);
        }
        IContinuousRewardToken(token).enableContinuousRewards();
        emit HolderStreamMarketRegistered(id, token, m.quote, vault);
    }

    /// @notice Compatibility bucket, NOT a time period: all new-mode fees use bucket 1 forever.
    function currentEpochId(bytes32 id) external view returns (uint32) { _market(id); return 1; }
    function feeSharingVault(bytes32 id) external view returns (address) { return _markets[id].vault; }
    function feeSharingExcludedAccounts(bytes32 id) external view returns (address[] memory) { return _exclusions[id]; }

    function fundCreatorFees(bytes32 id, uint32 bucket, uint256 amount) external payable nonReentrant {
        Market storage m = _market(id);
        if (msg.sender != m.vault) revert Unauthorized();
        if (bucket != 1 || amount == 0 || amount > type(uint128).max - m.funded) revert InvalidFunding();
        _checkpoint(id, m);
        uint64 end = _now() + uint64(STREAM_DURATION);
        _append(id, m, amount * PRECISION, end);
        if (m.quote == address(0)) {
            if (msg.value != amount) revert InvalidFunding();
        } else {
            if (msg.value != 0) revert InvalidFunding();
            uint256 beforeTo = IERC20(m.quote).balanceOf(address(this));
            uint256 beforeFrom = IERC20(m.quote).balanceOf(msg.sender);
            IERC20(m.quote).safeTransferFrom(msg.sender, address(this), amount);
            if (IERC20(m.quote).balanceOf(address(this)) != beforeTo + amount
                || IERC20(m.quote).balanceOf(msg.sender) + amount != beforeFrom) revert InexactTransfer();
        }
        lastFundingAt[id] = _now();
        m.funded += amount;
        totalLiability[m.quote] += amount;
        _solvent(m.quote);
        emit HolderStreamFunded(id, amount, end);
    }

    /// @notice Called before the canonical ERC-20 updates balances; never transfers assets or performs swaps.
    function checkpointTransfer(bytes32 id, address from, address to, uint256 amount) external nonReentrant {
        Market storage m = _market(id);
        if (msg.sender != m.token) revert Unauthorized();
        _checkpoint(id, m);
        _account(id, m, from);
        if (to != from) _account(id, m, to);
        if (from != to) {
            if (!excluded[id][from]) m.supply -= amount;
            if (!excluded[id][to]) m.supply += amount;
        }
        _restartIdle(id, m);
    }

    function claim(bytes32 id) external nonReentrant returns (uint256 amount) {
        Market storage m = _market(id);
        _checkpoint(id, m);
        _account(id, m, msg.sender);
        _restartIdle(id, m);
        Account storage a = _accounts[id][msg.sender];
        amount = a.earnedScaled / PRECISION;
        if (amount == 0) return 0;
        a.earnedScaled -= amount * PRECISION;
        m.paid += amount;
        totalLiability[m.quote] -= amount;
        if (m.quote == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            uint256 beforeTo = IERC20(m.quote).balanceOf(msg.sender);
            uint256 beforeFrom = IERC20(m.quote).balanceOf(address(this));
            IERC20(m.quote).safeTransfer(msg.sender, amount);
            if (IERC20(m.quote).balanceOf(msg.sender) != beforeTo + amount
                || IERC20(m.quote).balanceOf(address(this)) + amount != beforeFrom) revert InexactTransfer();
        }
        _solvent(m.quote);
        emit HolderStreamClaimed(id, msg.sender, m.quote, amount);
    }

    function checkpoint(bytes32 id) external nonReentrant {
        Market storage m = _market(id); _checkpoint(id, m); _restartIdle(id, m);
    }

    function claimable(bytes32 id, address user) external view returns (uint256) {
        Market storage m = _market(id);
        if (excluded[id][user]) return 0;
        Account storage a = _accounts[id][user];
        uint256 index = m.index;
        if (m.supply != 0) index += (_pendingRelease(id, m) + m.indexRemainder) / m.supply;
        return (a.earnedScaled + IERC20(m.token).balanceOf(user) * (index - a.index)) / PRECISION;
    }

    /// @notice Market totals, not a promise of any particular holder's future earnings.
    function releaseState(bytes32 id) external view returns (uint256 unreleased, uint256 idleQuote, uint64 nextEnd, uint256 activeStreams) {
        Market storage m = _market(id);
        uint256 scaled;
        for (uint256 i; i < m.count; ++i) {
            Stream storage stream = _streams[id][(uint256(m.head) + i) % MAX_STREAMS];
            if (stream.end <= block.timestamp) continue;
            scaled += stream.rate * (stream.end - block.timestamp) + stream.remainder;
            if (nextEnd == 0) nextEnd = stream.end;
            ++activeStreams;
        }
        unreleased = scaled / PRECISION;
        idleQuote = (m.idle + (m.supply == 0 ? _pendingRelease(id, m) : 0)) / PRECISION;
    }

    function marketState(bytes32 id) external view returns (Market memory) { return _market(id); }

    function _account(bytes32 id, Market storage m, address user) private {
        if (excluded[id][user]) return;
        Account storage a = _accounts[id][user];
        a.earnedScaled += IERC20(m.token).balanceOf(user) * (m.index - a.index);
        a.index = m.index;
    }

    function _checkpoint(bytes32 id, Market storage m) private {
        uint64 nowTs = _now();
        uint256 released;
        while (m.count != 0) {
            Stream storage s = _streams[id][m.head];
            if (s.end > nowTs) break;
            released += m.rate * (s.end - m.updatedAt) + s.remainder;
            m.updatedAt = s.end;
            m.rate -= s.rate;
            delete _streams[id][m.head];
            m.head = uint8((uint256(m.head) + 1) % MAX_STREAMS);
            --m.count;
        }
        released += m.rate * (nowTs - m.updatedAt);
        m.updatedAt = nowTs;
        if (m.supply == 0) { m.idle += released; return; }
        released += m.indexRemainder;
        m.index += released / m.supply;
        m.indexRemainder = released % m.supply;
    }

    function _pendingRelease(bytes32 id, Market storage m) private view returns (uint256 released) {
        uint256 last = m.updatedAt;
        uint256 rate = m.rate;
        for (uint256 i; i < m.count; ++i) {
            Stream storage s = _streams[id][(uint256(m.head) + i) % MAX_STREAMS];
            if (s.end > block.timestamp) break;
            released += rate * (s.end - last) + s.remainder;
            last = s.end; rate -= s.rate;
        }
        return released + rate * (block.timestamp - last);
    }

    function _append(bytes32 id, Market storage m, uint256 scaled, uint64 end) private {
        uint256 rate = scaled / STREAM_DURATION;
        uint256 tail = scaled % STREAM_DURATION;
        if (m.count != 0) {
            Stream storage last = _streams[id][(uint256(m.head) + m.count - 1) % MAX_STREAMS];
            if (last.end == end) { last.rate += rate; last.remainder += tail; m.rate += rate; return; }
        }
        if (m.count == MAX_STREAMS) revert StreamCapacity();
        _streams[id][(uint256(m.head) + m.count) % MAX_STREAMS] = Stream(end, rate, tail);
        ++m.count; m.rate += rate;
    }

    function _restartIdle(bytes32 id, Market storage m) private {
        if (m.idle == 0 || m.supply == 0 || m.count == MAX_STREAMS) return;
        uint256 amount = m.idle; m.idle = 0;
        uint64 end = _now() + uint64(STREAM_DURATION);
        _append(id, m, amount, end);
        emit IdleRewardsRestarted(id, amount, end);
    }

    function _market(bytes32 id) private view returns (Market storage m) {
        m = _markets[id]; if (m.token == address(0)) revert InvalidMarket();
    }
    function _now() private view returns (uint64) {
        if (block.timestamp > type(uint64).max - STREAM_DURATION) revert InvalidFunding();
        return uint64(block.timestamp);
    }
    function _solvent(address asset) private view {
        uint256 balance = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        if (balance < totalLiability[asset]) revert Insolvent();
    }
}
