// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {MarketConfig, MarketRuntime, MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultUserClaims} from "../../../src/v1/shared/ProtocolFeeVaultUserClaims.sol";
import {ProtocolFeeVaultLiabilities} from "../../../src/v1/shared/ProtocolFeeVaultLiabilities.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

contract HolderFeeRegistryMock {
    mapping(bytes32 => MarketView) internal values;
    address public immutable factory;

    constructor(address factory_) {
        factory = factory_;
    }

    function setMarket(bytes32 id, MarketView memory value) external {
        values[id] = value;
    }

    function market(bytes32 id) external view returns (MarketView memory) {
        return values[id];
    }
}

contract HolderFeePoolManagerMock {}

contract HolderFeeDistributorMock {
    mapping(bytes32 => uint32) public currentEpochId;

    function setEpoch(bytes32 id, uint32 epoch) external {
        currentEpochId[id] = epoch;
    }
    function fundCreatorFees(bytes32, uint32, uint256) external payable {}
}

contract HolderFeeCreatorMock {
    mapping(bytes32 => uint32) public currentCreatorEpoch;
    mapping(bytes32 => mapping(uint32 => address)) public creatorBeneficiaryAt;

    function setEpoch(bytes32 id, uint32 epoch, address beneficiary) external {
        currentCreatorEpoch[id] = epoch;
        creatorBeneficiaryAt[id][epoch] = beneficiary;
    }
}

contract HolderFeeMemeMock is MockExactQuoteToken {
    bytes32 public immutable marketId;
    address public immutable holderRewardsDistributor;
    uint256 public totalSupply;

    constructor(bytes32 id, address distributor) MockExactQuoteToken(18) {
        marketId = id;
        holderRewardsDistributor = distributor;
    }

    function mintSupply(address account, uint256 amount) external {
        this.mint(account, amount);
        totalSupply += amount;
    }
}

contract HolderFeeHookMock {
    address public immutable poolManager;
    address public immutable protocolFeeVault;
    MockExactQuoteToken public immutable meme;
    MockExactQuoteToken public immutable quote;

    constructor(address poolManager_, address vault_, MockExactQuoteToken meme_, MockExactQuoteToken quote_) {
        poolManager = poolManager_;
        protocolFeeVault = vault_;
        meme = meme_;
        quote = quote_;
    }

    function convertRewards(bytes32, uint256 amount, uint256) external returns (uint256 spent, uint256 received) {
        meme.transferFrom(msg.sender, address(this), amount);
        spent = amount;
        received = amount * 2;
        quote.mint(msg.sender, received);
    }
}

contract HolderFeeVaultHarness is ProtocolFeeVaultUserClaims {
    constructor(address registry, address creators, address treasury, bytes32 policy)
        ProtocolFeeVaultUserClaims(registry, address(new HolderFeePoolManagerMock()), creators, treasury, policy)
    {}

    function seedHolder(bytes32 id, uint32 epoch, address asset, uint256 amount) external {
        _creditHolderFee(id, epoch, asset, amount);
    }

    function recordCurve(
        bytes32 id,
        uint32 epoch,
        address asset,
        uint256 amount,
        uint256 creatorAmount,
        uint256 platformAmount
    ) external {
        _creditFeeLiabilities(id, epoch, asset, amount, creatorAmount, 0, platformAmount);
    }
}
