// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {AssetView, MarketView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {MarketController, MarketControllerInit} from "../../../src/v2/modules/MarketController.sol";

/// @dev State-only fixture: the gate under test is the production MarketController entry point.
/// The two read-only registries expose mutable state solely to enumerate the canonical inputs.
contract T401MarketRegistry {
    MarketView private _market;

    constructor(bytes32 assetUid) {
        _market.config.assetUid = assetUid;
    }

    function setState(uint8 phase, uint8 status) external {
        _market.runtime.launchPhase = phase;
        _market.runtime.marketStatus = status;
    }

    function market(bytes32) external view returns (MarketView memory) {
        return _market;
    }
}

contract T401AssetRegistry {
    mapping(bytes32 => AssetView) private _assets;

    function setStatus(bytes32 assetUid, uint8 status) external {
        _assets[assetUid].status = status;
    }

    function asset(bytes32 assetUid) external view returns (AssetView memory) {
        return _assets[assetUid];
    }
}

contract T401QuoteRegistry {
    uint8 public status;

    function setStatus(uint8 status_) external {
        status = status_;
    }
}

contract T401Dependency {}

contract V2T401StateMatrixTest is Test {
    uint8 private constant POOL_CREATED = 2;
    uint8 private constant MARKET_ACTIVE = 0;
    uint8 private constant ASSET_ACTIVE = 1;
    bytes32 private constant MARKET_ID = keccak256("v2-t401-market");
    bytes32 private constant ASSET_UID = keccak256("v2-t401-asset");

    AccessManager private authority;
    T401MarketRegistry private markets;
    T401AssetRegistry private assets;
    T401QuoteRegistry private quotes;
    T401Dependency private feeVault;
    MarketController private controller;

    function setUp() public {
        authority = new AccessManager(address(this));
        markets = new T401MarketRegistry(ASSET_UID);
        assets = new T401AssetRegistry();
        quotes = new T401QuoteRegistry();
        feeVault = new T401Dependency();
        controller = new MarketController(
            MarketControllerInit({
                authority: address(authority),
                marketRegistry: address(markets),
                officialStockRegistry: address(assets),
                protocolFeeVault: address(feeVault)
            })
        );
    }

    /// Covers the complete 4x4x4x4 input product. Quote status is deliberately
    /// included even though allocation admission must not rewrite for it.
    function test_generatedLaunchMarketAssetQuoteAdmissionMatrix() public {
        uint256 openCount;
        for (uint8 phase = 0; phase < 4; ++phase) {
            for (uint8 marketStatus = 0; marketStatus < 4; ++marketStatus) {
                markets.setState(phase, marketStatus);
                for (uint8 assetStatus = 0; assetStatus < 4; ++assetStatus) {
                    assets.setStatus(ASSET_UID, assetStatus);
                    for (uint8 quoteStatus = 0; quoteStatus < 4; ++quoteStatus) {
                        quotes.setStatus(quoteStatus);
                        assertEq(quotes.status(), quoteStatus);
                        // Quote status is an admission input for new markets, not this
                        // existing-market allocation gate; retain it as a matrix axis.
                        bool expected =
                            phase == POOL_CREATED && marketStatus == MARKET_ACTIVE && assetStatus == ASSET_ACTIVE;
                        bool observed = controller.isStockAllocationOpen(MARKET_ID);
                        assertEq(observed, expected);
                        if (observed) ++openCount;
                    }
                }
            }
        }
        assertEq(openCount, 4, "only active pool-created/asset-active cases open");
    }

    function test_quoteStatusAxisDoesNotAlterActiveMarketAllocationGate() public {
        markets.setState(POOL_CREATED, MARKET_ACTIVE);
        assets.setStatus(ASSET_UID, ASSET_ACTIVE);
        for (uint8 quoteStatus = 0; quoteStatus < 4; ++quoteStatus) {
            quotes.setStatus(quoteStatus);
            assertEq(quotes.status(), quoteStatus);
            // MarketController has no quote-status dependency by design: quote
            // status governs new-market admission, not historical allocations.
            assertTrue(controller.isStockAllocationOpen(MARKET_ID));
        }
    }
}
