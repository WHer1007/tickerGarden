import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionData,decodeFunctionData,type Hex} from 'viem';
import {userClaimsAbi,userClaimOutcome,rawUserClaimRequest,USER_CLAIM_MODE,LEGACY_USER_CLAIM_MODE} from '../src/v1/features/userClaims.ts';
const id=('0x'+'1'.repeat(64)) as Hex, vault=('0x'+'2'.repeat(40)) as Hex;
test('current raw claim has no swap arguments or retained output',()=>{
 for(const assets of [1,2,3]){
  const request=rawUserClaimRequest(USER_CLAIM_MODE,vault,id,2,0,assets);
  const data=encodeFunctionData(request);
  assert.deepEqual(decodeFunctionData({abi:userClaimsAbi,data}).args,[id,2,0,assets]);
 }
 assert.equal(userClaimsAbi.find(x=>x.type==='function'&&x.name==='claimUserRewardAssets')!.outputs.length,2);
});
test('historical deployment compatibility never enables conversion',()=>{
 const request=rawUserClaimRequest(LEGACY_USER_CLAIM_MODE,vault,id,1,0,3);
 assert.deepEqual(decodeFunctionData({abi:request.abi,data:encodeFunctionData(request)}).args,[id,1,0,3,false,false,0n]);
 assert.throws(()=>rawUserClaimRequest(id,vault,id,1,0,3),/Unsupported/);
});
test('claim receipts display only paid original assets',()=>{
 assert.equal(userClaimOutcome({quotePaid:20n,memePaid:30n}),'Quote And Original Meme Claimed');
 assert.equal(userClaimOutcome({quotePaid:20n}),'Quote Claimed');
 assert.equal(userClaimOutcome({memePaid:30n}),'Original Meme Claimed');
 assert.equal(userClaimOutcome({}),'No Rewards Available');
});
