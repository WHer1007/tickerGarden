import { keccak256,toHex } from 'viem';
export const USER_CLAIM_MODE=keccak256(toHex('TICKERGARDEN_USER_CLAIM_ASSET_SELECTION_V1'));
export const DUAL_HOLDER_MODE=keccak256(toHex('TICKERGARDEN_HOLDER_DUAL_ASSET_24H_V4'));
export const userClaimsAbi=[
 {type:'function',name:'userClaimMode',stateMutability:'pure',inputs:[],outputs:[{type:'bytes32'}]},
 {type:'function',name:'claimUserRewards',stateMutability:'nonpayable',inputs:[{name:'id',type:'bytes32'},{name:'role',type:'uint8'},{name:'epoch',type:'uint32'},{name:'convert',type:'bool'},{name:'rawFallback',type:'bool'},{name:'deadline',type:'uint256'}],outputs:[{name:'quotePaid',type:'uint256'},{name:'memePaid',type:'uint256'},{name:'memeRetained',type:'uint256'}]},
 {type:'function',name:'claimUserRewardAssets',stateMutability:'nonpayable',inputs:[{name:'id',type:'bytes32'},{name:'role',type:'uint8'},{name:'epoch',type:'uint32'},{name:'assets',type:'uint8'},{name:'convert',type:'bool'},{name:'rawFallback',type:'bool'},{name:'deadline',type:'uint256'}],outputs:[{name:'quotePaid',type:'uint256'},{name:'memePaid',type:'uint256'},{name:'memeRetained',type:'uint256'}]},
 {type:'event',name:'UserRewardsClaimed',anonymous:false,inputs:[{name:'marketId',type:'bytes32',indexed:true},{name:'user',type:'address',indexed:true},{name:'role',type:'uint8',indexed:true},{name:'creatorEpoch',type:'uint32',indexed:false},{name:'quotePaid',type:'uint256',indexed:false},{name:'memePaid',type:'uint256',indexed:false},{name:'memeRetained',type:'uint256',indexed:false},{name:'memeConverted',type:'uint256',indexed:false},{name:'conversionFailed',type:'bool',indexed:false}]},
 {type:'function',name:'claimableAssets',stateMutability:'view',inputs:[{type:'bytes32'},{type:'address'}],outputs:[{type:'uint256'},{type:'uint256'}]},
] as const;

export function userClaimOutcome(args: Record<string, unknown>): string {
  const n=(key:string)=>typeof args[key]==='bigint'?args[key] as bigint:0n;
  if(n('memeRetained')>0n) return n('memeConverted')>0n?'Partial Conversion; Remaining Meme Retained':n('quotePaid')>0n?'Quote Claimed; Meme Retained':'Conversion Failed; Meme Retained';
  if(n('memePaid')>0n) return n('memeConverted')>0n?'Converted Quote And Remaining Meme Claimed':n('quotePaid')>0n?'Quote And Original Meme Claimed':'Original Meme Claimed';
  return n('quotePaid')>0n?'Quote Claimed':'No Rewards Available';
}
