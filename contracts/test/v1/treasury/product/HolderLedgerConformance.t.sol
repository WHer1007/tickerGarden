// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HolderRewardsDistributorV1Test} from "./HolderRewardsDistributorV1.t.sol";
import {HolderRewardsDistributorV1} from "../../../../src/v1/modules/HolderRewardsDistributorV1.sol";

/// Emits a small, replayable call-history fixture for the independent Go
/// holder-ledger model. Values are read from the deployed Solidity contract;
/// this test intentionally does not duplicate expected arithmetic constants.
contract HolderLedgerConformance is HolderRewardsDistributorV1Test {
    function _step(string memory kind, uint256 ts, address from, address to, address account, uint256 amount) internal {
        string memory j = vm.serializeString("action", "kind", kind);
        j = vm.serializeUint("action", "timestamp", ts);
        j = vm.serializeString("action", "from", vm.toString(from));
        j = vm.serializeString("action", "to", vm.toString(to));
        j = vm.serializeString("action", "account", vm.toString(account));
        j = vm.serializeUint("action", "amount", amount);
        emit log_string(vm.serializeString("step", "action", j));
        emit log_string(_state());
    }

    function _state() internal returns (string memory j) {
        HolderRewardsDistributorV1.Market memory m = d.marketState(ID);
        j = vm.serializeUint("state", "updatedAt", m.updatedAt);
        j = vm.serializeUint("state", "supply", m.supply);
        j = vm.serializeUint("state", "index", m.index);
        j = vm.serializeUint("state", "indexRemainder", m.indexRemainder);
        j = vm.serializeUint("state", "rate", m.rate);
        j = vm.serializeUint("state", "idle", m.idle);
        j = vm.serializeUint("state", "funded", m.funded);
        j = vm.serializeUint("state", "paid", m.paid);
        j = vm.serializeUint("state", "head", m.head);
        j = vm.serializeUint("state", "streamCount", m.count);
        j = vm.serializeUint("state", "lastFundingAt", d.lastFundingAt(ID));
        j = vm.serializeUint("state", "aliceBalance", token.balanceOf(ALICE));
        j = vm.serializeUint("state", "bobBalance", token.balanceOf(BOB));
        j = vm.serializeUint("state", "curveBalance", token.balanceOf(CURVE));
        j = vm.serializeUint("state", "aliceClaimable", d.claimable(ID, ALICE));
        j = vm.serializeUint("state", "bobClaimable", d.claimable(ID, BOB));
        j = vm.serializeUint("state", "curveClaimable", d.claimable(ID, CURVE));
    }

    function _registration() internal {
        string memory j = vm.serializeString("registration", "marketId", vm.toString(ID));
        j = vm.serializeString("registration", "token", vm.toString(address(token)));
        j = vm.serializeUint("registration", "timestamp", block.timestamp);
        j = vm.serializeUint("registration", "totalSupply", token.totalSupply());
        j = vm.serializeAddress("registration", "excluded", d.feeSharingExcludedAccounts(ID));
        j = vm.serializeAddress("registration", "alice", ALICE);
        j = vm.serializeAddress("registration", "bob", BOB);
        j = vm.serializeAddress("registration", "curve", CURVE);
        j = vm.serializeAddress("registration", "distributor", address(d));
        j = vm.serializeUint("registration", "aliceBalance", token.balanceOf(ALICE));
        j = vm.serializeUint("registration", "bobBalance", token.balanceOf(BOB));
        j = vm.serializeUint("registration", "curveBalance", token.balanceOf(CURVE));
        j = vm.serializeUint("registration", "tokenBalance", token.balanceOf(address(token)));
        j = vm.serializeUint("registration", "distributorBalance", token.balanceOf(address(d)));
        emit log_string(j);
    }

    function test_exportHolderLedgerConformance() public {
        _registration();
        _send(CURVE, ALICE, 100 ether); _step("transfer", block.timestamp, CURVE, ALICE, address(0), 100 ether);
        uint256 start = block.timestamp;
        _send(CURVE, address(d), 1 ether); _step("transfer", start, CURVE, address(d), address(0), 1 ether);
        vm.prank(address(d)); token.burnTreasury(1 ether); _step("burn", start, address(d), address(0), address(0), 1 ether);
        _fund(10 ether); _step("fund", start, address(vault), address(d), address(0), 10 ether);
        vm.warp(start + 3 hours);
        _fund(6 ether); _step("fund", block.timestamp, address(vault), address(d), address(0), 6 ether);
        _fund(1); _step("fund", block.timestamp, address(vault), address(d), address(0), 1);
        vm.warp(start + 12 hours);
        _step("view", block.timestamp, address(0), address(0), address(0), 0);
        _send(ALICE, BOB, 40 ether); _step("transfer", block.timestamp, ALICE, BOB, address(0), 40 ether);
        vm.prank(BOB); d.claim(ID); _step("claim", block.timestamp, BOB, address(0), BOB, 0);
        d.checkpoint(ID); _step("checkpoint", block.timestamp, address(0), address(0), address(0), 0);
        _send(BOB, BOB, 0); _step("transfer", block.timestamp, BOB, BOB, address(0), 0);
        _send(ALICE, CURVE, 60 ether); _step("transfer", block.timestamp, ALICE, CURVE, address(0), 60 ether);
        _send(BOB, CURVE, 40 ether); _step("transfer", block.timestamp, BOB, CURVE, address(0), 40 ether);
        vm.warp(start + 18 hours);
        _send(CURVE, ALICE, 100 ether); _step("transfer", block.timestamp, CURVE, ALICE, address(0), 100 ether);
        vm.warp(start + 48 hours);
        uint256 alicePaid = _claim(ALICE); _step("claim", block.timestamp, ALICE, address(0), ALICE, alicePaid);
        uint256 bobPaid = _claim(BOB); _step("claim", block.timestamp, BOB, address(0), BOB, bobPaid);
    }
}
