// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {MarketView} from "./IV1Protocol.sol";
contract EvidenceToken {
 mapping(address=>uint256) public balanceOf;
 mapping(address=>mapping(address=>uint256)) public allowance;
 function mint(address who,uint256 n) external {balanceOf[who]+=n;}
 function approve(address who,uint256 n) external returns(bool){allowance[msg.sender][who]=n;return true;}
 function transferFrom(address from,address to,uint256 n) external returns(bool){allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true;}
}
contract EvidenceRegistry {
 MarketView private value;
 function configure(address meme,address quote,address hook) external {
  value.config.memeToken=meme;value.config.quoteAsset=quote;value.config.graduatedHook=hook;
  value.runtime.launchPhase=1;
 }
 function setGauge(address gauge) external {value.config.gauge=gauge;value.config.stakingEnabled=true;}
 function market(bytes32) external view returns(MarketView memory){return value;}
}
contract EvidenceCreators {
 address immutable user;
 constructor(address u){user=u;}
 function currentCreatorEpoch(bytes32) external pure returns(uint32){return 1;}
 function creatorBeneficiaryAt(bytes32,uint32) external view returns(address){return user;}
}
contract EvidenceHook {
 EvidenceToken immutable meme;EvidenceToken immutable quote;
 constructor(address m,address q){meme=EvidenceToken(m);quote=EvidenceToken(q);}
 receive() external payable {}
 function convertRewards(bytes32,uint256 total,uint256 minimum,uint256) external returns(uint256,uint256){
  require(total==3 && minimum<=100,"fixture inputs");
  require(meme.transferFrom(msg.sender,address(this),1));if(address(quote)==address(0)){(bool ok,)=payable(msg.sender).call{value:100}("");require(ok);}else{quote.mint(msg.sender,100);}return(1,100);
 }
}

contract EvidenceManager {
 function rageQuitSettlementPending(bytes32,address) external pure returns(bool,uint256){return(false,0);}
 function rewardCohortEpoch(bytes32) external pure returns(uint256){return 0;}
 function rewardEligibleActiveStock(bytes32) external pure returns(uint256){return 1;}
}
