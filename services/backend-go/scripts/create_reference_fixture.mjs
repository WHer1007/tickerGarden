// Test fixture only: ephemeral keys never leave this process.
import fs from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
const preview=JSON.parse(fs.readFileSync(0,'utf8'));
const state=preview.candidate.state;
const now=Math.floor(Date.now()/1000);
const sources=[],references=[];
for(const id of ['fixture-source-a','fixture-source-b']){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const key=Buffer.from(publicKey.export({format:'jwk'}).x,'base64url').toString('base64');
 sources.push({id,publicKey:key});
 const price={version:'tickergarden-conversion-reference-v1',sourceId:id,chainId:state.chainId,genesisHash:state.genesisHash,marketId:state.marketId,memeToken:state.memeToken,quoteAsset:state.quoteAsset,requestDigest:preview.candidate.request.requestDigest,observedAt:now,expiresAt:now+30,quoteUnits:preview.received,memeUnits:preview.spent};
 references.push({price,signature:sign(null,Buffer.from(JSON.stringify(price)),privateKey).toString('base64')});
}
console.log(JSON.stringify({policy:{chainId:state.chainId,genesisHash:state.genesisHash,marketId:state.marketId,memeToken:state.memeToken,quoteAsset:state.quoteAsset,sources,maxAgeSeconds:30,maxDeviationBps:100,minimumActiveLiquidity:'1000'},references}));
