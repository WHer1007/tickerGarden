// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MarketConfig, MarketRuntime, MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";

contract RewardSettlementRegistryMock {
    mapping(bytes32 => MarketView) private markets;

    function configure(bytes32 id, address hook, address quote, address meme, address gauge) external {
        MarketConfig memory c;
        c.graduatedHook = hook;
        c.quoteAsset = quote;
        c.memeToken = meme;
        c.gauge = gauge;
        c.stakingEnabled = true;
        c.feePolicyId = keccak256("policy");
        c.executionSpecId = keccak256("V1-EXEC-11");
        MarketRuntime memory r;
        r.poolId = keccak256("pool");
        r.sourceVersion = 1;
        r.launchPhase = 1;
        markets[id] = MarketView(c, r);
    }

    function disableStaking(bytes32 id) external {
        markets[id].config.stakingEnabled = false;
        markets[id].config.gauge = address(0);
    }

    function market(bytes32 id) external view returns (MarketView memory) {
        return markets[id];
    }

    function setLaunchPhase(bytes32 id, uint8 phase) external {
        markets[id].runtime.launchPhase = phase;
    }
}

contract RewardSettlementPoolManagerMock {}

contract RewardSettlementCreatorMock {
    mapping(bytes32 => uint32) public currentCreatorEpoch;
    mapping(bytes32 => mapping(uint32 => address)) public creatorBeneficiaryAt;

    function setEpoch(bytes32 id, uint32 epoch, address who) external {
        currentCreatorEpoch[id] = epoch;
        creatorBeneficiaryAt[id][epoch] = who;
    }
}
