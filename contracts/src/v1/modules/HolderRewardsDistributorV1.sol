// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AuthorityUtils} from "@openzeppelin/contracts/access/manager/AuthorityUtils.sol";
import {IMarketRegistryV1, ITickerMemeTokenV1, MarketView} from "../interfaces/IV1Protocol.sol";
import {IContinuousRewardToken} from "../interfaces/IContinuousHolderRewards.sol";

interface IContinuousRewardsHook {
    function poolManager() external view returns (address);
    function protocolFeeVault() external view returns (address);
}

interface IHolderFundingAuthority {
    function authority() external view returns (address);
}

/// @notice Fully funded holder rewards: pending funds coalesce, each admitted batch streams for 24 hours.
/// @dev No holder iteration, historical logs, root publisher or expiry of already-earned rewards.
///      Admission uses a governed per-market interval. Existing streams never change their end time.
contract HolderRewardsDistributorV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant STREAM_DURATION = 24 hours;
    uint256 public constant FUNDING_INTERVAL = 4 hours;
    uint256 public constant MIN_FUNDING_INTERVAL = 1 hours;
    uint256 public constant MAX_FUNDING_INTERVAL = 24 hours;
    // Fixed ring modulus: changing an interval must never reinterpret existing storage slots.
    uint256 public constant MAX_STREAMS = STREAM_DURATION / MIN_FUNDING_INTERVAL;
    uint256 public constant PRECISION = 1e27;
    bytes32 public constant REWARD_MODE = keccak256("TICKERGARDEN_HOLDER_DUAL_ASSET_24H_V4");
    address public immutable marketRegistry;

    struct Stream {
        uint64 end;
        uint256 rate;
        uint256 remainder;
    }

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

    struct Account {
        uint256 index;
        uint256 earnedScaled;
    }

    mapping(bytes32 => Market) private _markets;
    mapping(bytes32 => Market) private _memeMarkets;
    mapping(bytes32 => uint64) private _assetStreamStartedAt;
    mapping(bytes32 => mapping(uint256 => Stream)) private _streams;
    mapping(bytes32 => mapping(address => Account)) private _accounts;
    mapping(bytes32 => mapping(address => bool)) public excluded;
    mapping(bytes32 => address[]) private _exclusions;
    mapping(address => uint256) public totalLiability;
    mapping(bytes32 => uint64) public lastFundingAt;
    mapping(bytes32 => uint64) public lastStreamStartedAt;
    mapping(bytes32 => uint256) private _fundingIntervals;

    error InvalidMarket();
    error Unauthorized();
    error InvalidFunding();
    error StreamCapacity();
    error InexactTransfer();
    error TransferFailed();
    error Insolvent();
    error InvalidFundingInterval();
    event HolderStreamMarketRegistered(bytes32 indexed marketId, address indexed token, address quote, address vault);
    event HolderAssetFunded(bytes32 indexed marketId, address indexed asset, uint256 amount);
    event HolderMemeRestored(bytes32 indexed marketId, address indexed account, uint256 amount);
    event HolderRewardsQueued(bytes32 indexed marketId, uint256 amount);
    event HolderStreamFunded(bytes32 indexed marketId, uint256 amount, uint64 end);
    event HolderStreamClaimed(bytes32 indexed marketId, address indexed account, address asset, uint256 amount);
    event IdleRewardsRestarted(bytes32 indexed marketId, uint256 scaledAmount, uint64 end);
    event HolderFundingIntervalUpdated(bytes32 indexed marketId, uint256 previousInterval, uint256 newInterval);

    constructor(address registry) {
        if (registry.code.length == 0) revert InvalidMarket();
        marketRegistry = registry;
    }

    function rewardMode() external pure returns (bytes32) {
        return REWARD_MODE;
    }

    /// @notice Current admission interval; FUNDING_INTERVAL is the default, not the live value.
    function fundingInterval(bytes32 id) public view returns (uint256) {
        _market(id);
        uint256 interval = _fundingIntervals[id];
        return interval == 0 ? FUNDING_INTERVAL : interval;
    }

    /// @notice Changes future admission only. Does not release, move or restart existing rewards.
    /// @dev Uses the protocol's existing AccessManager; delayed calls execute through that manager.
    function setFundingInterval(bytes32 id, uint256 interval) external nonReentrant {
        address stockRegistry = IMarketRegistryV1(marketRegistry).officialStockRegistry();
        address authority = IHolderFundingAuthority(stockRegistry).authority();
        (bool immediate,) = AuthorityUtils.canCallWithDelay(authority, msg.sender, address(this), msg.sig);
        if (!immediate) revert Unauthorized();
        if (interval < MIN_FUNDING_INTERVAL || interval > MAX_FUNDING_INTERVAL) revert InvalidFundingInterval();
        uint256 previous = fundingInterval(id);
        _fundingIntervals[id] = interval;
        emit HolderFundingIntervalUpdated(id, previous, interval);
    }

    function registerFeeSharingMarket(bytes32 id, address vault, address locker) external nonReentrant {
        if (msg.sender != IMarketRegistryV1(marketRegistry).factory()) revert Unauthorized();
        MarketView memory v = IMarketRegistryV1(marketRegistry).market(id);
        address token = v.config.memeToken;
        if (
            id == bytes32(0) || _markets[id].token != address(0) || token.code.length == 0
                || !v.config.creatorFeesToHolders || locker == address(0) || vault.code.length == 0
                || IContinuousRewardsHook(v.config.graduatedHook).protocolFeeVault() != vault
                || ITickerMemeTokenV1(token).marketId() != id
                || ITickerMemeTokenV1(token).holderRewardsDistributor() != address(this) || v.config.quoteAsset == token
        ) revert InvalidMarket();
        Market storage m = _markets[id];
        m.token = token;
        m.quote = v.config.quoteAsset;
        m.vault = vault;
        m.updatedAt = _now();
        address[9] memory list = [
            address(0),
            address(0xdead),
            token,
            v.config.curve,
            IContinuousRewardsHook(v.config.graduatedHook).poolManager(),
            locker,
            address(this),
            vault,
            v.config.graduatedHook
        ];
        m.supply = IERC20(token).totalSupply();
        for (uint256 i; i < list.length; ++i) {
            if (excluded[id][list[i]]) continue;
            excluded[id][list[i]] = true;
            _exclusions[id].push(list[i]);
            m.supply -= IERC20(token).balanceOf(list[i]);
        }
        Market storage mm = _memeMarkets[id];
        mm.token = token;
        mm.quote = token;
        mm.vault = vault;
        mm.updatedAt = _now();
        mm.supply = m.supply;
        IContinuousRewardToken(token).enableContinuousRewards();
        emit HolderStreamMarketRegistered(id, token, m.quote, vault);
    }

    /// @notice Accounting bucket, not a time period: current-mode fees use bucket 1.
    function rewardBucket(bytes32 id) external view returns (uint32) {
        _market(id);
        return 1;
    }

    function feeSharingVault(bytes32 id) external view returns (address) {
        return _markets[id].vault;
    }

    function feeSharingExcludedAccounts(bytes32 id) external view returns (address[] memory) {
        return _exclusions[id];
    }

    function fundQuoteRewards(bytes32 id, uint32 bucket, uint256 amount) public payable nonReentrant {
        Market storage m = _market(id);
        if (msg.sender != m.vault) revert Unauthorized();
        if (bucket != 1 || amount == 0 || amount > type(uint128).max - m.funded) revert InvalidFunding();
        _checkpoint(id, m);
        if (m.quote == address(0)) {
            if (msg.value != amount) revert InvalidFunding();
        } else {
            if (msg.value != 0) revert InvalidFunding();
            uint256 beforeTo = IERC20(m.quote).balanceOf(address(this));
            uint256 beforeFrom = IERC20(m.quote).balanceOf(msg.sender);
            IERC20(m.quote).safeTransferFrom(msg.sender, address(this), amount);
            if (
                IERC20(m.quote).balanceOf(address(this)) != beforeTo + amount
                    || IERC20(m.quote).balanceOf(msg.sender) + amount != beforeFrom
            ) revert InexactTransfer();
        }
        lastFundingAt[id] = _now();
        m.funded += amount;
        totalLiability[m.quote] += amount;
        _solvent(m.quote);
        m.idle += amount * PRECISION;
        emit HolderRewardsQueued(id, amount);
        emit HolderAssetFunded(id, m.quote, amount);
        _restartIdle(id, m);
    }

    /// @notice Called before the canonical ERC-20 updates balances; never transfers assets or performs swaps.
    function checkpointTransfer(bytes32 id, address from, address to, uint256 amount) external {
        Market storage m = _market(id);
        if (msg.sender != m.token) revert Unauthorized();
        _checkpoint(id, m);
        _checkpoint(id, _memeMarkets[id]);
        uint256 fromBalance = _checkpointBalance(id, m, from, 3);
        uint256 toBalance = to == from ? fromBalance : _checkpointBalance(id, m, to, 3);
        _transferCheckpoint(id, m, from, to, amount, fromBalance, toBalance);
        _transferCheckpoint(id, _memeMarkets[id], from, to, amount, fromBalance, toBalance);
    }

    function _transferCheckpoint(
        bytes32 id,
        Market storage m,
        address from,
        address to,
        uint256 amount,
        uint256 fromBalance,
        uint256 toBalance
    ) private {
        _account(id, m, from, fromBalance);
        if (to != from) _account(id, m, to, toBalance);
        if (from != to) {
            if (!excluded[id][from]) m.supply -= amount;
            if (!excluded[id][to]) m.supply += amount;
        }
        _restartIdle(id, m);
    }

    function _settleAccount(bytes32 id, Market storage m, address user, uint256 balance) internal {
        _checkpoint(id, m);
        _account(id, m, user, balance);
        _restartIdle(id, m);
    }

    function _payAccount(bytes32 id, Market storage m, address user, address recipient)
        internal
        returns (uint256 amount)
    {
        Account storage a = _accounts[_ledgerKey(id, m)][user];
        amount = a.earnedScaled / PRECISION;
        if (amount == 0) return 0;
        _solvent(m.quote);
        a.earnedScaled -= amount * PRECISION;
        m.paid += amount;
        totalLiability[m.quote] -= amount;
        if (m.quote == address(0)) {
            (bool ok,) = payable(recipient).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            uint256 beforeTo = IERC20(m.quote).balanceOf(recipient);
            uint256 beforeFrom = IERC20(m.quote).balanceOf(address(this));
            IERC20(m.quote).safeTransfer(recipient, amount);
            if (
                IERC20(m.quote).balanceOf(recipient) != beforeTo + amount
                    || IERC20(m.quote).balanceOf(address(this)) + amount != beforeFrom
            ) revert InexactTransfer();
        }
        _solvent(m.quote);
        emit HolderStreamClaimed(id, user, m.quote, amount);
    }

    function consumeUserRewards(bytes32 id, address user) external nonReentrant returns (uint256 quote, uint256 meme) {
        return _consumeUserRewardAssets(id, user, 3);
    }

    function consumeUserRewardAssets(bytes32 id, address user, uint8 assets)
        external
        nonReentrant
        returns (uint256 quote, uint256 meme)
    {
        return _consumeUserRewardAssets(id, user, assets);
    }

    function _consumeUserRewardAssets(bytes32 id, address user, uint8 assets)
        private
        returns (uint256 quote, uint256 meme)
    {
        Market storage m = _market(id);
        if (msg.sender != m.vault) revert Unauthorized();
        if (assets == 0 || assets > 3) revert InvalidFunding();
        Market storage mm = _memeMarkets[id];
        if (assets & 1 != 0) _checkpoint(id, m);
        if (assets & 2 != 0) _checkpoint(id, mm);
        uint256 balance = _checkpointBalance(id, m, user, assets);
        // Settle every selected ledger before any external payment callback.
        if (assets & 1 != 0) {
            _account(id, m, user, balance);
            _restartIdle(id, m);
        }
        if (assets & 2 != 0) {
            _account(id, mm, user, balance);
            _restartIdle(id, mm);
        }
        if (assets & 1 != 0) quote = _payAccount(id, m, user, m.vault);
        if (assets & 2 != 0) meme = _payAccount(id, mm, user, m.vault);
    }

    /// @dev Checkpoints must run first. Historical unpaid index growth still requires the actual balance.
    function _checkpointBalance(bytes32 id, Market storage m, address user, uint8 assets)
        private
        view
        returns (uint256)
    {
        if (excluded[id][user]) return 0;
        bool needsBalance = assets & 1 != 0 && _accounts[id][user].index != m.index;
        if (!needsBalance && assets & 2 != 0) {
            Market storage mm = _memeMarkets[id];
            needsBalance = _accounts[_ledgerKey(id, mm)][user].index != mm.index;
        }
        return needsBalance ? IERC20(m.token).balanceOf(user) : 0;
    }

    function restoreUserMeme(bytes32 id, address user, uint256 amount) external nonReentrant {
        Market storage m = _memeMarkets[id];
        _market(id);
        if (msg.sender != m.vault || amount == 0 || amount > m.paid) revert Unauthorized();
        _receiveToken(m.quote, amount);
        // Refund only the consumed user's earned balance; never starts another release stream.
        _accounts[_ledgerKey(id, m)][user].earnedScaled += amount * PRECISION;
        m.paid -= amount;
        totalLiability[m.quote] += amount;
        _solvent(m.quote);
        emit HolderMemeRestored(id, user, amount);
    }

    function fundMemeFees(bytes32 id, uint256 amount) external nonReentrant {
        _market(id);
        Market storage m = _memeMarkets[id];
        if (msg.sender != m.vault) revert Unauthorized();
        if (amount == 0 || amount > type(uint128).max - m.funded) revert InvalidFunding();
        _checkpoint(id, m);
        _receiveToken(m.quote, amount);
        m.funded += amount;
        totalLiability[m.quote] += amount;
        _solvent(m.quote);
        m.idle += amount * PRECISION;
        emit HolderAssetFunded(id, m.quote, amount);
        _restartIdle(id, m);
    }

    function _receiveToken(address token, uint256 amount) private {
        uint256 beforeTo = IERC20(token).balanceOf(address(this));
        uint256 beforeFrom = IERC20(token).balanceOf(msg.sender);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (
            IERC20(token).balanceOf(address(this)) != beforeTo + amount
                || IERC20(token).balanceOf(msg.sender) + amount != beforeFrom
        ) revert InexactTransfer();
    }

    function checkpoint(bytes32 id) external nonReentrant {
        Market storage m = _market(id);
        _checkpoint(id, m);
        _restartIdle(id, m);
        m = _memeMarkets[id];
        _checkpoint(id, m);
        _restartIdle(id, m);
    }

    function claimable(bytes32 id, address user) external view returns (uint256) {
        Market storage m = _market(id);
        return _claimable(id, m, user, _eligibleBalance(id, m.token, user));
    }

    function claimableAssets(bytes32 id, address user) external view returns (uint256 quote, uint256 meme) {
        Market storage m = _market(id);
        uint256 balance = _eligibleBalance(id, m.token, user);
        quote = _claimable(id, m, user, balance);
        meme = _claimable(id, _memeMarkets[id], user, balance);
    }

    function _claimable(bytes32 id, Market storage m, address user, uint256 balance) private view returns (uint256) {
        if (excluded[id][user]) return 0;
        Account storage a = _accounts[_ledgerKey(id, m)][user];
        uint256 index = m.index;
        if (m.supply != 0) index += (_pendingRelease(id, m) + m.indexRemainder) / m.supply;
        return (a.earnedScaled + balance * (index - a.index)) / PRECISION;
    }

    /// @notice Market totals, not a promise of any particular holder's future earnings.
    function releaseState(bytes32 id)
        external
        view
        returns (uint256 unreleased, uint256 idleQuote, uint64 nextEnd, uint256 activeStreams)
    {
        Market storage m = _market(id);
        bytes32 key = _ledgerKey(id, m);
        uint256 scaled;
        for (uint256 i; i < m.count; ++i) {
            Stream storage stream = _streams[key][(uint256(m.head) + i) % MAX_STREAMS];
            if (stream.end <= block.timestamp) continue;
            scaled += stream.rate * (stream.end - block.timestamp) + stream.remainder;
            if (nextEnd == 0) nextEnd = stream.end;
            ++activeStreams;
        }
        unreleased = scaled / PRECISION;
        idleQuote = (m.idle + (m.supply == 0 ? _pendingRelease(id, m) : 0)) / PRECISION;
    }

    function memeMarketState(bytes32 id) external view returns (Market memory) {
        _market(id);
        return _memeMarkets[id];
    }

    function _ledgerKey(bytes32 id, Market storage m) private view returns (bytes32) {
        return m.quote == m.token ? keccak256(abi.encode(id, m.token)) : id;
    }

    function marketState(bytes32 id) external view returns (Market memory) {
        return _market(id);
    }

    function _eligibleBalance(bytes32 id, address token, address user) private view returns (uint256) {
        return excluded[id][user] ? 0 : IERC20(token).balanceOf(user);
    }

    function _account(bytes32 id, Market storage m, address user, uint256 balance) private {
        if (excluded[id][user]) return;
        Account storage a = _accounts[_ledgerKey(id, m)][user];
        uint256 index = m.index;
        if (a.index == index) return;
        a.earnedScaled += balance * (index - a.index);
        a.index = index;
    }

    function _checkpoint(bytes32 id, Market storage m) private {
        bytes32 key = _ledgerKey(id, m);
        uint64 nowTs = _now();
        uint256 released;
        while (m.count != 0) {
            Stream storage s = _streams[key][m.head];
            if (s.end > nowTs) break;
            released += m.rate * (s.end - m.updatedAt) + s.remainder;
            m.updatedAt = s.end;
            m.rate -= s.rate;
            delete _streams[key][m.head];
            m.head = uint8((uint256(m.head) + 1) % MAX_STREAMS);
            --m.count;
        }
        released += m.rate * (nowTs - m.updatedAt);
        m.updatedAt = nowTs;
        if (m.supply == 0) {
            m.idle += released;
            return;
        }
        released += m.indexRemainder;
        m.index += released / m.supply;
        m.indexRemainder = released % m.supply;
    }

    function _pendingRelease(bytes32 id, Market storage m) private view returns (uint256 released) {
        bytes32 key = _ledgerKey(id, m);
        uint256 last = m.updatedAt;
        uint256 rate = m.rate;
        for (uint256 i; i < m.count; ++i) {
            Stream storage s = _streams[key][(uint256(m.head) + i) % MAX_STREAMS];
            if (s.end > block.timestamp) break;
            released += rate * (s.end - last) + s.remainder;
            last = s.end;
            rate -= s.rate;
        }
        return released + rate * (block.timestamp - last);
    }

    function _append(bytes32 id, Market storage m, uint256 scaled, uint64 end) private {
        bytes32 key = _ledgerKey(id, m);
        uint256 rate = scaled / STREAM_DURATION;
        uint256 tail = scaled % STREAM_DURATION;
        if (m.count != 0) {
            Stream storage last = _streams[key][(uint256(m.head) + m.count - 1) % MAX_STREAMS];
            if (last.end == end) {
                last.rate += rate;
                last.remainder += tail;
                m.rate += rate;
                return;
            }
        }
        if (m.count == MAX_STREAMS) revert StreamCapacity();
        _streams[key][(uint256(m.head) + m.count) % MAX_STREAMS] = Stream(end, rate, tail);
        ++m.count;
        m.rate += rate;
    }

    /// @notice Earliest admission time; public funding cannot move this clock forward.
    function nextStreamStartAt(bytes32 id) public view returns (uint64) {
        _market(id);
        return _nextStart(id, _markets[id]);
    }

    function memeNextStreamStartAt(bytes32 id) external view returns (uint64) {
        _market(id);
        return _nextStart(id, _memeMarkets[id]);
    }

    function _nextStart(bytes32 id, Market storage m) private view returns (uint64) {
        uint64 last = _assetStreamStartedAt[_ledgerKey(id, m)];
        return last == 0 && m.count == 0 ? 0 : last + uint64(fundingInterval(id));
    }

    function _restartIdle(bytes32 id, Market storage m) private {
        if (
            m.idle == 0 || m.supply == 0
                || (block.timestamp < _nextStart(id, m) && block.timestamp != _assetStreamStartedAt[_ledgerKey(id, m)])
        ) return;
        uint256 amount = m.idle;
        m.idle = 0;
        uint64 end = _now() + uint64(STREAM_DURATION);
        _append(id, m, amount, end);
        _assetStreamStartedAt[_ledgerKey(id, m)] = _now();
        if (m.quote != m.token) lastStreamStartedAt[id] = _now();
        if (m.quote != m.token) emit IdleRewardsRestarted(id, amount, end);
    }

    function _market(bytes32 id) internal view returns (Market storage m) {
        m = _markets[id];
        if (m.token == address(0)) revert InvalidMarket();
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
