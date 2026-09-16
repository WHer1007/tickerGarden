// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {ProtocolFeeVaultUserClaims} from "../../../src/v1/shared/ProtocolFeeVaultUserClaims.sol";
import {RewardSettlementCreatorMock, RewardSettlementPoolManagerMock} from "../shared/RewardSettlement.t.sol";
import {UserClaimGauge} from "../shared/UserRewardClaims.t.sol";

contract BurnRegistry {
    MarketView private v;
    function set(MarketView memory value) external { v = value; }
    function market(bytes32) external view returns (MarketView memory) { return v; }
}
contract BurnHolder {
    uint256 public quoteFunded;
    function fundQuoteRewards(bytes32, uint32, uint256 amount) external payable { require(msg.value == amount); quoteFunded += amount; }
}
contract BurnToken is ERC20 {
    address public holderRewardsDistributor;
    bool public fail;
    bool public lie;
    constructor(address d) ERC20("Meme", "MEME") { holderRewardsDistributor = d; }
    function mint(address to,uint256 n) external { _mint(to,n); }
    function setFailure(bool f,bool l) external { fail=f;lie=l; }
    function burn(uint256 n) external { require(!fail,"BURN_FAILED"); if(!lie) _burn(msg.sender,n); }
}
contract BurnVault is ProtocolFeeVaultUserClaims {
    constructor(address r,address p,address c) ProtocolFeeVaultUserClaims(r,p,c,address(0x7000),keccak256("policy")) {}
    function seed(bytes32 id,address asset,uint256 creator,uint256 staker,uint256 platform) external {
        _creditFeeLiabilities(id,1,asset,creator+staker+platform,creator,staker,platform);
    }
    function seedHolder(bytes32 id,address asset,uint256 amount) external { _creditHolderFee(id,1,asset,amount); }
}
contract MemeFeeBurnTest is Test {
    bytes32 constant ID=keccak256("burn");
    address constant ALICE=address(0xa11ce);
    BurnVault vault; BurnRegistry registry; BurnToken token; BurnHolder holder; UserClaimGauge gauge;
    function setUp() public {
        registry=new BurnRegistry();holder=new BurnHolder();token=new BurnToken(address(holder));
        gauge=new UserClaimGauge(address(token),address(0));
        RewardSettlementCreatorMock creators=new RewardSettlementCreatorMock();creators.setEpoch(ID,1,ALICE);
        vault=new BurnVault(address(registry),address(new RewardSettlementPoolManagerMock()),address(creators));
        MarketView memory v;v.config.memeToken=address(token);v.config.quoteAsset=address(0);v.config.curve=address(this);
        v.config.graduatedHook=address(this);v.config.gauge=address(gauge);v.config.stakingEnabled=true;
        v.config.creatorFeesToHolders=true;v.config.burnMemeFees=true;registry.set(v);
        token.mint(address(vault),1000);vm.deal(address(vault),10 ether);
        vault.seed(ID,address(token),100,200,300);vault.seedHolder(ID,address(token),400);
        vault.seed(ID,address(0),1 ether,2 ether,3 ether);vault.seedHolder(ID,address(0),4 ether);
        gauge.set(ALICE,address(token),200);gauge.set(ALICE,address(0),2 ether);
    }
    function test_creatorQuoteOnlyAlsoBurnsMemeAndCannotRepeat() public {
        vm.startPrank(ALICE);(uint256 q,uint256 m)=vault.claimUserRewardAssets(ID,0,1,1);
        assertEq(q,1 ether);assertEq(m,0);assertEq(token.totalSupply(),900);assertEq(token.balanceOf(ALICE),0);
        vault.claimUserRewards(ID,0,1);vm.stopPrank();assertEq(token.totalSupply(),900);assertEq(vault.liability(ID,address(token),2),300);
    }
    function test_stakerMemeOnlyBurnsButPreservesQuote() public {
        vm.prank(ALICE);(uint256 q,uint256 m)=vault.claimUserRewardAssets(ID,1,0,2);
        assertEq(q,0);assertEq(m,0);assertEq(token.totalSupply(),800);assertEq(gauge.pending(ALICE,address(0)),2 ether);
        assertEq(vault.totalLiability(address(token)),800);
    }
    function test_holderQuoteFundingAlsoBurnsMemeAndPlatformPaidNormally() public {
        vault.fundHolderRewards(ID,1);assertEq(token.totalSupply(),600);assertEq(holder.quoteFunded(),4 ether);
        assertEq(token.balanceOf(address(holder)),0);assertEq(vault.holderLiability(ID,1,address(token)),0);
        vault.fundHolderMemeRewards(ID);assertEq(token.totalSupply(),600);
        assertEq(vault.claimPlatform(ID,address(token)),300);assertEq(token.balanceOf(address(0x7000)),300);
        assertEq(token.totalSupply(),600);assertEq(vault.totalLiability(address(token)),300);
    }
    function test_burnFailureRollsBackQuotePaymentAndLiabilities() public {
        token.setFailure(true,false);vm.prank(ALICE);vm.expectRevert("BURN_FAILED");vault.claimUserRewards(ID,0,1);
        assertEq(ALICE.balance,0);assertEq(vault.creatorLiability(ID,1,address(0)),1 ether);assertEq(token.totalSupply(),1000);
        token.setFailure(false,true);vm.prank(ALICE);vm.expectRevert();vault.claimUserRewards(ID,0,1);
        assertEq(vault.creatorLiability(ID,1,address(token)),100);assertEq(ALICE.balance,0);
    }
    function test_holderBatchFailureIsRetryable() public {
        token.setFailure(true,false);bytes32[] memory ids=new bytes32[](1);ids[0]=ID;
        vault.fundHolderRewardsBatch(ids,3,500000);assertEq(vault.holderLiability(ID,1,address(token)),400);assertEq(holder.quoteFunded(),0);
        token.setFailure(false,false);vault.fundHolderRewardsBatch(ids,3,500000);assertEq(token.totalSupply(),600);assertEq(holder.quoteFunded(),4 ether);
    }
    function test_disabledModePaysMemeNormally() public {
        MarketView memory v=registry.market(ID);v.config.burnMemeFees=false;registry.set(v);
        vm.prank(ALICE);vault.claimUserRewards(ID,0,1);assertEq(token.balanceOf(ALICE),100);assertEq(token.totalSupply(),1000);
    }
    function test_unauthorizedCreatorAndLockedStakerCannotBurn() public {
        vm.expectRevert();vault.claimUserRewards(ID,0,1);gauge.setLock(true);
        vm.prank(ALICE);vm.expectRevert("LOCKED");vault.claimUserRewards(ID,1,0);assertEq(token.totalSupply(),1000);
    }
    function test_transfersNeverBurn() public {
        token.mint(ALICE,20);vm.prank(ALICE);token.transfer(address(0xbeef),10);assertEq(token.totalSupply(),1020);
    }
}
