// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {AllocationManager} from "../../../src/v1/modules/AllocationManager.sol";
import {UserStockVault} from "../../../src/v1/modules/UserStockVault.sol";
import {MockAllocationMarketRegistry, MockFullExitGauge} from "../product/AllocationManager.t.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {StockTokenFingerprintTestLib} from "../mocks/StockTokenFingerprintTestLib.sol";

/// @dev Real Registry, Manager and Vault; market routing and gauge are test doubles.
contract StockVaultIdentityGasTest is Test {
    bytes32 constant ASSET = keccak256("gas-stock");
    bytes32 constant MARKET = keccak256("gas-market");
    address constant USER = address(0xA11CE);
    OfficialStockRegistryV1 registry;
    AllocationManager manager;
    UserStockVault vault;
    MockExactQuoteToken token;

    function setUp() public {
        registry = new OfficialStockRegistryV1(address(new AccessManager(address(this))));
        MockAllocationMarketRegistry markets = new MockAllocationMarketRegistry();
        manager = new AllocationManager(address(registry), address(markets));
        vault = new UserStockVault(address(registry), address(markets), address(manager));
        token = new MockExactQuoteToken(18);
        token.setUid(ASSET);
        registry.registerAsset(
            ASSET, address(token), 18, address(vault), 0.5 ether, StockTokenFingerprintTestLib.direct(address(token))
        );
        MockFullExitGauge gauge = new MockFullExitGauge();
        markets.configure(MARKET, ASSET, address(gauge));
        gauge.configure(address(manager), vault, ASSET, MARKET);
        token.mint(USER, 2 ether);
        vm.prank(USER);
        token.approve(address(vault), 2 ether);
    }

    function testGas_stakeWithCanonicalVaultIdentity() public {
        vm.prank(USER);
        uint256 before = gasleft();
        manager.stake(MARKET, 2 ether);
        uint256 used = before - gasleft();
        emit log_named_uint("stake call gas (mock gauge)", used);
        assertLt(used, 750_000, "stake must not rescan pinned runtime");
        assertEq(vault.deposited(ASSET, USER), 2 ether);
        assertEq(vault.allocation(ASSET, USER, MARKET), 2 ether);
        assertEq(token.balanceOf(USER), 0);
    }
}
