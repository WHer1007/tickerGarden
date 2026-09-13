// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HolderRewardsDistributorV1} from "../../../src/v1/modules/HolderRewardsDistributorV1.sol";

/// @dev Isolated holder accounting test harness; deployment uses the production distributor.
contract HolderAccountingHarness is HolderRewardsDistributorV1 {
    constructor(address registry) HolderRewardsDistributorV1(registry) {}

    function claim(bytes32 id) external nonReentrant returns (uint256) {
        Market storage m = _market(id);
        uint256 balance = excluded[id][msg.sender] ? 0 : IERC20(m.token).balanceOf(msg.sender);
        _settleAccount(id, m, msg.sender, balance);
        return _payAccount(id, m, msg.sender, msg.sender);
    }
}
