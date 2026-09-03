// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {AssetView, MarketView, StockTokenFingerprint} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {ProtocolFeeVault, ProtocolFeeVaultInit} from "../../../src/v1/modules/ProtocolFeeVault.sol";
import {UserStockVault} from "../../../src/v1/modules/UserStockVault.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {StockTokenFingerprintTestLib} from "../mocks/StockTokenFingerprintTestLib.sol";

/// @dev This token deliberately exposes every ERC-20 settlement failure mode used by the invariant.
contract MultiAssetMaliciousToken is MockExactQuoteToken {
    enum Mode {
        EXACT,
        FEE_ON_TRANSFER,
        FALSE_RETURN,
        NO_DATA,
        MALFORMED_RETURN,
        REVERTING,
        POSITIVE_DRIFT
    }

    Mode public mode;

    constructor(uint8 decimals_) MockExactQuoteToken(decimals_) {}

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function transfer(address recipient, uint256 amount) external override returns (bool) {
        Mode current = mode;
        if (current == Mode.REVERTING) revert("malicious transfer");
        if (current == Mode.FALSE_RETURN) return false;
        if (current == Mode.NO_DATA) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        if (current == Mode.MALFORMED_RETURN) {
            assembly ("memory-safe") {
                mstore(0, 2)
                return(0, 32)
            }
        }
        _settle(msg.sender, recipient, amount, current);
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external override returns (bool) {
        Mode current = mode;
        if (current == Mode.REVERTING) revert("malicious transferFrom");
        if (current == Mode.FALSE_RETURN) return false;
        if (current == Mode.NO_DATA) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        if (current == Mode.MALFORMED_RETURN) {
            assembly ("memory-safe") {
                mstore(0, 2)
                return(0, 32)
            }
        }
        uint256 currentAllowance = allowance[owner][msg.sender];
        if (currentAllowance != type(uint256).max) allowance[owner][msg.sender] = currentAllowance - amount;
        _settle(owner, recipient, amount, current);
        return true;
    }

    function _settle(address owner, address recipient, uint256 amount, Mode current) private {
        if (current == Mode.FEE_ON_TRANSFER) {
            balanceOf[owner] -= amount;
            balanceOf[recipient] += amount - 1;
            return;
        }
        _transfer(owner, recipient, amount);
        if (current == Mode.POSITIVE_DRIFT) balanceOf[recipient] += 1;
    }
}

contract MultiAssetMarketRegistryMock {
    mapping(bytes32 marketId => MarketView value) private _markets;

    function configure(bytes32 marketId, bytes32 assetUid) external {
        _markets[marketId].config.assetUid = assetUid;
    }

    function configureFeeMarket(bytes32 marketId, address gauge, address quoteAsset, address memeToken) external {
        _markets[marketId].config.gauge = gauge;
        _markets[marketId].config.quoteAsset = quoteAsset;
        _markets[marketId].config.memeToken = memeToken;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract MultiAssetAllocationManagerMock {
    UserStockVault private _vault;

    function setVault(UserStockVault vault_) external {
        require(address(_vault) == address(0), "vault already set");
        _vault = vault_;
    }

    function lock(bytes32 assetUid, address user, bytes32 marketId, uint256 amount) external {
        _vault.lockAllocation(assetUid, user, marketId, amount);
    }

    function release(bytes32 assetUid, address user, bytes32 marketId) external returns (uint256) {
        return _vault.releaseAllocation(assetUid, user, marketId);
    }
}

contract MultiAssetFeeGaugeMock {
    mapping(address user => mapping(address asset => uint256 amount)) private _claimable;

    function addClaimable(address user, address asset, uint256 amount) external {
        _claimable[user][asset] += amount;
    }

    function claimable(address user, address asset) external view returns (uint256) {
        return _claimable[user][asset];
    }

    function consumeClaimable(address user, address asset) external returns (uint256 amount) {
        amount = _claimable[user][asset];
        delete _claimable[user][asset];
    }
}

contract MultiAssetFeeVaultHarness is ProtocolFeeVault {
    bytes32 public constant FEE_MARKET = keccak256("multi-asset-fee-market");

    constructor(address marketRegistry_, address gauge_, address quoteAsset_, address memeAsset_)
        ProtocolFeeVault(ProtocolFeeVaultInit({
                marketRegistry: marketRegistry_,
                poolManager: address(new MockExactQuoteToken(18)),
                creatorRevenueRegistry: address(new MockExactQuoteToken(18)),
                platformTreasury: address(new MockExactQuoteToken(18)),
                feePolicyId: keccak256("multi-asset-fee-policy")
            }))
    {
        // Dependencies are code-bearing only; this harness exposes the production liability path directly.
        MultiAssetMarketRegistryMock(marketRegistry_).configureFeeMarket(FEE_MARKET, gauge_, quoteAsset_, memeAsset_);
    }

    function creditStaker(address asset, uint256 amount) external {
        _creditFeeLiabilities(FEE_MARKET, 1, asset, amount, 0, amount, 0);
    }

    function stakerLiability(address asset) external view returns (uint256) {
        return this.totalLiability(asset);
    }
}

contract MultiAssetSettlementHandler is Test {
    uint256 internal constant MAX_AMOUNT = 100 ether;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    UserStockVault public immutable vault;
    MultiAssetAllocationManagerMock public immutable manager;
    MultiAssetMaliciousToken[2] public stock;
    MultiAssetMaliciousToken[2] public feeAsset;
    MultiAssetFeeVaultHarness public immutable feeVault;
    MultiAssetFeeGaugeMock public immutable feeGauge;
    bytes32[2] public assetUid;
    bytes32[2] public marketId;
    address[2] private _users = [ALICE, BOB];

    constructor(
        UserStockVault vault_,
        MultiAssetAllocationManagerMock manager_,
        MultiAssetMaliciousToken stockA,
        MultiAssetMaliciousToken stockB,
        MultiAssetMaliciousToken feeA,
        MultiAssetMaliciousToken feeB,
        MultiAssetFeeVaultHarness feeVault_,
        MultiAssetFeeGaugeMock feeGauge_
    ) {
        vault = vault_;
        manager = manager_;
        stock = [stockA, stockB];
        feeAsset = [feeA, feeB];
        feeVault = feeVault_;
        feeGauge = feeGauge_;
        assetUid = [keccak256("multi-stock-a"), keccak256("multi-stock-b")];
        marketId = [keccak256("multi-market-a"), keccak256("multi-market-b")];
    }

    function setStockMode(uint8 assetSeed, uint8 mode) external {
        stock[assetSeed % 2].setMode(MultiAssetMaliciousToken.Mode(mode % 7));
    }

    function setFeeMode(uint8 assetSeed, uint8 mode) external {
        feeAsset[assetSeed % 2].setMode(MultiAssetMaliciousToken.Mode(mode % 7));
    }

    function deposit(uint8 assetSeed, uint8 userSeed, uint96 rawAmount) external {
        uint256 index = assetSeed % 2;
        address user = _users[userSeed % 2];
        uint256 amount = bound(uint256(rawAmount), 1, MAX_AMOUNT);
        MultiAssetMaliciousToken token = stock[index];
        token.mint(user, amount);
        vm.startPrank(user);
        token.approve(address(vault), amount);
        try vault.depositStock(assetUid[index], amount) {} catch {}
        vm.stopPrank();
    }

    function withdraw(uint8 assetSeed, uint8 userSeed, uint96 rawAmount) external {
        uint256 index = assetSeed % 2;
        address user = _users[userSeed % 2];
        uint256 free = vault.freeBalanceOf(assetUid[index], user);
        if (free == 0) return;
        uint256 amount = bound(uint256(rawAmount), 1, free);
        vm.prank(user);
        try vault.withdrawFreeStock(assetUid[index], amount) {} catch {}
    }

    function lock(uint8 assetSeed, uint8 userSeed, uint96 rawAmount) external {
        uint256 index = assetSeed % 2;
        address user = _users[userSeed % 2];
        uint256 free = vault.freeBalanceOf(assetUid[index], user);
        if (free == 0) return;
        uint256 amount = bound(uint256(rawAmount), 1, free);
        try manager.lock(assetUid[index], user, marketId[index], amount) {} catch {}
    }

    function release(uint8 assetSeed, uint8 userSeed) external {
        uint256 index = assetSeed % 2;
        address user = _users[userSeed % 2];
        try manager.release(assetUid[index], user, marketId[index]) {} catch {}
    }

    function accrueFee(uint8 assetSeed, uint8 userSeed, uint96 rawAmount) external {
        uint256 index = assetSeed % 2;
        address user = _users[userSeed % 2];
        uint256 amount = bound(uint256(rawAmount), 1, MAX_AMOUNT);
        MultiAssetMaliciousToken token = feeAsset[index];
        token.mint(address(feeVault), amount);
        feeVault.creditStaker(address(token), amount);
        feeGauge.addClaimable(user, address(token), amount);
    }

    function claimFee(uint8 assetSeed, uint8 userSeed) external {
        uint256 index = assetSeed % 2;
        address user = _users[userSeed % 2];
        try feeVault.claimStakerFor(user, feeVault.FEE_MARKET(), address(feeAsset[index])) {} catch {}
    }

    function userAt(uint256 index) external view returns (address) {
        return _users[index];
    }
}

contract MultiAssetMaliciousSettlementInvariantTest is StdInvariant, Test {
    uint64 internal constant PROTOCOL_ADMIN_ROLE = 1;
    uint256 internal constant MINIMUM_ALLOCATION = 0.5 ether;
    bytes32 internal constant ASSET_A = keccak256("multi-stock-a");
    bytes32 internal constant ASSET_B = keccak256("multi-stock-b");
    bytes32 internal constant MARKET_A = keccak256("multi-market-a");
    bytes32 internal constant MARKET_B = keccak256("multi-market-b");
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    AccessManager internal accessManager;
    OfficialStockRegistryV1 internal registry;
    MultiAssetMarketRegistryMock internal marketRegistry;
    MultiAssetAllocationManagerMock internal manager;
    UserStockVault internal vault;
    MultiAssetMaliciousToken[2] internal stock;
    MultiAssetMaliciousToken[2] internal feeAsset;
    MultiAssetFeeGaugeMock internal feeGauge;
    MultiAssetFeeVaultHarness internal feeVault;
    MultiAssetSettlementHandler internal handler;

    function setUp() public {
        accessManager = new AccessManager(address(this));
        registry = new OfficialStockRegistryV1(address(accessManager));
        marketRegistry = new MultiAssetMarketRegistryMock();
        stock[0] = new MultiAssetMaliciousToken(18);
        stock[1] = new MultiAssetMaliciousToken(18);
        feeAsset[0] = new MultiAssetMaliciousToken(6);
        feeAsset[1] = new MultiAssetMaliciousToken(18);
        stock[0].setUid(ASSET_A);
        stock[1].setUid(ASSET_B);
        feeGauge = new MultiAssetFeeGaugeMock();
        feeVault = new MultiAssetFeeVaultHarness(
            address(marketRegistry), address(feeGauge), address(feeAsset[0]), address(feeAsset[1])
        );
        manager = new MultiAssetAllocationManagerMock();
        vault = new UserStockVault(address(registry), address(marketRegistry), address(manager));
        manager.setVault(vault);
        bytes4[] memory registrySelectors = new bytes4[](1);
        registrySelectors[0] = registry.registerAsset.selector;
        accessManager.setTargetFunctionRole(address(registry), registrySelectors, PROTOCOL_ADMIN_ROLE);
        accessManager.grantRole(PROTOCOL_ADMIN_ROLE, address(this), 0);
        registry.registerAsset(
            ASSET_A,
            address(stock[0]),
            18,
            address(vault),
            MINIMUM_ALLOCATION,
            StockTokenFingerprintTestLib.direct(address(stock[0]))
        );
        registry.registerAsset(
            ASSET_B,
            address(stock[1]),
            18,
            address(vault),
            MINIMUM_ALLOCATION,
            StockTokenFingerprintTestLib.direct(address(stock[1]))
        );
        marketRegistry.configure(MARKET_A, ASSET_A);
        marketRegistry.configure(MARKET_B, ASSET_B);

        handler = new MultiAssetSettlementHandler(
            vault, manager, stock[0], stock[1], feeAsset[0], feeAsset[1], feeVault, feeGauge
        );
        bytes4[] memory invariantSelectors = new bytes4[](8);
        invariantSelectors[0] = handler.setStockMode.selector;
        invariantSelectors[1] = handler.setFeeMode.selector;
        invariantSelectors[2] = handler.deposit.selector;
        invariantSelectors[3] = handler.withdraw.selector;
        invariantSelectors[4] = handler.lock.selector;
        invariantSelectors[5] = handler.release.selector;
        invariantSelectors[6] = handler.accrueFee.selector;
        invariantSelectors[7] = handler.claimFee.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: invariantSelectors}));
    }

    function test_maliciousStockSettlementRollsBackDepositAndWithdrawal() public {
        _depositExact(0, ALICE, 10 ether);
        _depositExact(1, ALICE, 11 ether);

        MultiAssetMaliciousToken.Mode[6] memory modes = [
            MultiAssetMaliciousToken.Mode.FEE_ON_TRANSFER,
            MultiAssetMaliciousToken.Mode.FALSE_RETURN,
            MultiAssetMaliciousToken.Mode.NO_DATA,
            MultiAssetMaliciousToken.Mode.MALFORMED_RETURN,
            MultiAssetMaliciousToken.Mode.REVERTING,
            MultiAssetMaliciousToken.Mode.POSITIVE_DRIFT
        ];
        for (uint256 i; i < modes.length; ++i) {
            stock[0].setMode(modes[i]);
            uint256 beforeDeposited = vault.deposited(ASSET_A, ALICE);
            uint256 beforeVaultBalance = stock[0].balanceOf(address(vault));
            uint256 beforeUserBalance = stock[0].balanceOf(ALICE);
            vm.prank(ALICE);
            try vault.depositStock(ASSET_A, 1 ether) {} catch {}
            assertEq(vault.deposited(ASSET_A, ALICE), beforeDeposited);
            assertEq(stock[0].balanceOf(address(vault)), beforeVaultBalance);
            assertEq(stock[0].balanceOf(ALICE), beforeUserBalance);

            beforeDeposited = vault.deposited(ASSET_A, ALICE);
            beforeVaultBalance = stock[0].balanceOf(address(vault));
            beforeUserBalance = stock[0].balanceOf(ALICE);
            vm.prank(ALICE);
            try vault.withdrawFreeStock(ASSET_A, 1 ether) {} catch {}
            assertEq(vault.deposited(ASSET_A, ALICE), beforeDeposited);
            assertEq(stock[0].balanceOf(address(vault)), beforeVaultBalance);
            assertEq(stock[0].balanceOf(ALICE), beforeUserBalance);
        }
    }

    function test_maliciousFeeSettlementRestoresLiabilityAndGaugeClaimable() public {
        uint256 amount = 123_456;
        feeAsset[0].mint(address(feeVault), amount);
        feeVault.creditStaker(address(feeAsset[0]), amount);
        feeGauge.addClaimable(ALICE, address(feeAsset[0]), amount);
        feeAsset[0].setMode(MultiAssetMaliciousToken.Mode.FEE_ON_TRANSFER);

        vm.prank(ALICE);
        try feeVault.claimStakerFor(ALICE, feeVault.FEE_MARKET(), address(feeAsset[0])) {} catch {}
        assertEq(feeVault.totalLiability(address(feeAsset[0])), amount);
        assertEq(feeAsset[0].balanceOf(address(feeVault)), amount);
        assertEq(feeGauge.claimable(ALICE, address(feeAsset[0])), amount);

        feeAsset[0].setMode(MultiAssetMaliciousToken.Mode.EXACT);
        uint256 beforeUser = feeAsset[0].balanceOf(ALICE);
        vm.prank(ALICE);
        feeVault.claimStakerFor(ALICE, feeVault.FEE_MARKET(), address(feeAsset[0]));
        assertEq(feeVault.totalLiability(address(feeAsset[0])), 0);
        assertEq(feeAsset[0].balanceOf(address(feeVault)), 0);
        assertEq(feeAsset[0].balanceOf(ALICE) - beforeUser, amount);
        assertEq(feeGauge.claimable(ALICE, address(feeAsset[0])), 0);
    }

    function invariant_eachStockAssetHasIndependentActualBalanceSolvency() public view {
        for (uint256 i; i < 2; ++i) {
            bytes32 uid = i == 0 ? ASSET_A : ASSET_B;
            bytes32 market = i == 0 ? MARKET_A : MARKET_B;
            uint256 ledgerTotal;
            uint256 allocatedTotal;
            for (uint256 j; j < 2; ++j) {
                address user = handler.userAt(j);
                uint256 userDeposited = vault.deposited(uid, user);
                uint256 userAllocated = vault.allocated(uid, user);
                assertEq(userDeposited, vault.freeBalanceOf(uid, user) + userAllocated);
                assertEq(userAllocated, vault.allocation(uid, user, market));
                ledgerTotal += userDeposited;
                allocatedTotal += userAllocated;
            }
            assertEq(ledgerTotal, vault.totalDeposited(uid));
            assertEq(allocatedTotal, vault.totalAllocated(uid));
            assertEq(stock[i].balanceOf(address(vault)), ledgerTotal);
        }
    }

    function invariant_eachFeeAssetHasIndependentLiabilitySolvency() public view {
        assertEq(feeAsset[0].balanceOf(address(feeVault)), feeVault.totalLiability(address(feeAsset[0])));
        assertEq(feeAsset[1].balanceOf(address(feeVault)), feeVault.totalLiability(address(feeAsset[1])));
    }

    function _depositExact(uint256 index, address user, uint256 amount) private {
        stock[index].setMode(MultiAssetMaliciousToken.Mode.EXACT);
        stock[index].mint(user, amount);
        vm.startPrank(user);
        stock[index].approve(address(vault), amount);
        vault.depositStock(index == 0 ? ASSET_A : ASSET_B, amount);
        vm.stopPrank();
    }
}
