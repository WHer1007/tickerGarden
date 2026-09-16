import { keccak256,toHex,type Address,type Hex,type Abi } from 'viem';
export const LEGACY_USER_CLAIM_MODE=keccak256(toHex('TICKERGARDEN_USER_CLAIM_ASSET_SELECTION_V1'));
export const USER_CLAIM_MODE=keccak256(toHex('TICKERGARDEN_USER_CLAIM_RAW_ASSETS_V1'));
export const DUAL_HOLDER_MODE=keccak256(toHex('TICKERGARDEN_HOLDER_DUAL_ASSET_24H_V4'));
const legacyUserClaimsAbi=[
 {type:'function',name:'userClaimMode',stateMutability:'pure',inputs:[],outputs:[{type:'bytes32'}]},
 {type:'function',name:'claimUserRewards',stateMutability:'nonpayable',inputs:[{name:'id',type:'bytes32'},{name:'role',type:'uint8'},{name:'epoch',type:'uint32'},{name:'convert',type:'bool'},{name:'rawFallback',type:'bool'},{name:'deadline',type:'uint256'}],outputs:[{name:'quotePaid',type:'uint256'},{name:'memePaid',type:'uint256'},{name:'memeRetained',type:'uint256'}]},
 {type:'function',name:'claimUserRewardAssets',stateMutability:'nonpayable',inputs:[{name:'id',type:'bytes32'},{name:'role',type:'uint8'},{name:'epoch',type:'uint32'},{name:'assets',type:'uint8'},{name:'convert',type:'bool'},{name:'rawFallback',type:'bool'},{name:'deadline',type:'uint256'}],outputs:[{name:'quotePaid',type:'uint256'},{name:'memePaid',type:'uint256'},{name:'memeRetained',type:'uint256'}]},
 {type:'event',name:'UserRewardsClaimed',anonymous:false,inputs:[{name:'marketId',type:'bytes32',indexed:true},{name:'user',type:'address',indexed:true},{name:'role',type:'uint8',indexed:true},{name:'creatorEpoch',type:'uint32',indexed:false},{name:'quotePaid',type:'uint256',indexed:false},{name:'memePaid',type:'uint256',indexed:false},{name:'memeRetained',type:'uint256',indexed:false},{name:'memeConverted',type:'uint256',indexed:false},{name:'conversionFailed',type:'bool',indexed:false}]},
 {type:'function',name:'claimableAssets',stateMutability:'view',inputs:[{type:'bytes32'},{type:'address'}],outputs:[{type:'uint256'},{type:'uint256'}]},
] as const;

export const userClaimsAbi=legacyUserClaimsAbi.map(entry => {
  if (entry.type === 'function' && (entry.name === 'claimUserRewards' || entry.name === 'claimUserRewardAssets')) {
    return {...entry, inputs:entry.inputs.slice(0, entry.name === 'claimUserRewards' ? 3 : 4), outputs:entry.outputs.slice(0,2)};
  }
  if (entry.type === 'event') return {...entry, inputs:entry.inputs.slice(0,6)};
  return entry;
});
/** Historical deployed vaults are raw-only at the client boundary too. Never request conversion. */
export function rawUserClaimRequest(mode: Hex, address: Address, id: Hex, role: number, epoch: number, assets: number) {
  if (![USER_CLAIM_MODE,LEGACY_USER_CLAIM_MODE].includes(mode)) throw Error('Unsupported Reward Claim Mode');
  if (![1,2,3].includes(assets)) throw Error('Invalid reward assets');
  return {abi:(mode===USER_CLAIM_MODE?userClaimsAbi:legacyUserClaimsAbi) as Abi,address,functionName:'claimUserRewardAssets' as const,
    args:mode===USER_CLAIM_MODE?[id,role,epoch,assets]:[id,role,epoch,assets,false,false,0n]};
}
export function userClaimOutcome(args: Record<string, unknown>): string {
  const n=(key:string)=>typeof args[key]==='bigint'?args[key] as bigint:0n;
  if(n('memePaid')>0n) return n('quotePaid')>0n?'Paired Asset And Created Token Claimed':'Created Token Claimed';
  return n('quotePaid')>0n?'Quote Claimed':'No Rewards Available';
}
