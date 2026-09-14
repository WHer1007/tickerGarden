import http from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient,http as viemHttp,recoverMessageAddress} from '../../apps/web/node_modules/viem/_esm/index.js';

const port=Number(process.env.TG_LOCAL_CREATOR_METADATA_PORT||8797);
const webOrigin=process.env.TG_LOCAL_CREATOR_WEB_ORIGIN||'http://127.0.0.1:5179';
const challenges=new Map(),uploads=new Map();
const storePath=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../../.codex_tmp/local-creator-claim/metadata-store.json');
const runtimePath=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../../.codex_tmp/local-creator-claim/runtime.json');
const holderAbi=JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname),'../../contracts/out/HolderRewardsDistributorV1.sol/HolderRewardsDistributorV1.json'))).abi;
const runtime=()=>JSON.parse(fs.readFileSync(runtimePath,'utf8'));
const rpcClient=createPublicClient({transport:viemHttp(runtime().rpc)});
const stored=(()=>{try{return new Map(Object.entries(JSON.parse(fs.readFileSync(storePath,'utf8'))));}catch{return new Map();}})();
const base32=bytes=>{const alphabet='abcdefghijklmnopqrstuvwxyz234567';let bits=0,value=0,result='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){result+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)result+=alphabet[(value<<(5-bits))&31];return result;};
const metadataCid=metadata=>`b${base32(Buffer.concat([Buffer.from([1,0x55,0x12,0x20]),createHash('sha256').update(JSON.stringify(metadata)).digest()]))}`;
const persist=()=>{fs.mkdirSync(path.dirname(storePath),{recursive:true});fs.writeFileSync(storePath,JSON.stringify(Object.fromEntries(stored),null,2));};
const json=(response,status,value)=>{response.writeHead(status,{'content-type':'application/json','access-control-allow-origin':webOrigin,'access-control-allow-headers':'content-type,x-upload-nonce,x-upload-signature,authorization','access-control-allow-methods':'GET,POST,OPTIONS','cache-control':'no-store'});response.end(JSON.stringify(value));};
const body=async request=>{const chunks=[];for await(const chunk of request)chunks.push(chunk);return Buffer.concat(chunks).toString('utf8');};
const messageFor=(account,digest,nonce,expires)=>`TickerGarden Metadata Upload\nOrigin: ${webOrigin}\nChain ID: 46630\nWallet: ${account}\nContent SHA-256: ${digest}\nNonce: ${nonce}\nExpires: ${expires}\nAuthorize one metadata upload. No transaction or token approval.`;

const server=http.createServer(async(request,response)=>{
 try{
  if(request.method==='OPTIONS')return json(response,204,{});
  const url=new URL(request.url||'/',`http://127.0.0.1:${port}`);
  const holderScenario=runtime().holderScenario;
  if(request.method==='GET'&&url.pathname==='/v1/holder-markets'){
   const q=(url.searchParams.get('q')||'').trim().toLowerCase();
   const items=holderScenario&&[holderScenario.market.name,holderScenario.market.symbol,holderScenario.market.memeToken].some(value=>value.toLowerCase().includes(q))
    ? [{marketId:holderScenario.market.marketId,memeToken:holderScenario.market.memeToken,name:holderScenario.market.name,symbol:holderScenario.market.symbol}]:[];
   return json(response,200,{chainId:46630,complete:true,items});
  }
  if(request.method==='GET'&&url.pathname==='/v1/wallet-holder-markets'){
   const account=(url.searchParams.get('account')||'').toLowerCase();
   const items=holderScenario&&account===holderScenario.holder.address
    ? [{marketId:holderScenario.market.marketId,memeToken:holderScenario.market.memeToken,name:holderScenario.market.name,symbol:holderScenario.market.symbol}]:[];
   return json(response,200,{chainId:46630,account,displayOnly:true,complete:true,items});
  }
  if(request.method==='GET'&&url.pathname==='/v1/holder-snapshots'){
   if(!holderScenario)return json(response,503,{error:'holder_scenario_not_prepared'});
   const chainId=Number(url.searchParams.get('chainId')),distributor=(url.searchParams.get('distributor')||'').toLowerCase(),marketId=(url.searchParams.get('marketId')||'').toLowerCase(),account=(url.searchParams.get('account')||'').toLowerCase();
   const active=runtime();
   if(chainId!==46630||distributor!==active.holderDistributor||marketId!==holderScenario.market.marketId||account!==holderScenario.holder.address)return json(response,400,{error:'invalid_snapshot_identity'});
   const [head,claimed]=await Promise.all([
    rpcClient.getBlock(),
    rpcClient.readContract({address:active.holderDistributor,abi:holderAbi,functionName:'claimedAssets',args:[marketId,BigInt(holderScenario.round.round),account]}),
   ]);
   return json(response,200,{schema:'TICKERGARDEN_HOLDER_WALLET_SNAPSHOTS_V1',chainId:46630,distributor,marketId,account,quote:'0x0000000000000000000000000000000000000000',meme:holderScenario.market.memeToken,displayOnly:true,finality:'finalized',sourceBlockNumber:String(head.number),sourceBlockHash:head.hash.toLowerCase(),status:'ready',rounds:[{round:holderScenario.round.round,snapshotBlock:holderScenario.round.snapshotBlock,root:holderScenario.round.root,quoteAmount:holderScenario.round.quoteAmount,memeAmount:holderScenario.round.tokenAmount,claimedAssets:Number(claimed),proof:holderScenario.round.proof}],nextCursor:null});
  }
  const content=/^\/ipfs\/(b[a-z2-7]{58})$/.exec(url.pathname);
  if(request.method==='GET'&&content){const metadata=stored.get(content[1]);return metadata?json(response,200,metadata):json(response,404,{error:'not_found'});}
  if(request.method==='POST'&&url.pathname==='/v1/content/challenges'){
   const input=JSON.parse(await body(request)),account=String(input.account||'').toLowerCase(),digest=String(input.digest||'');
   if(!/^0x[0-9a-f]{40}$/.test(account)||!/^[0-9a-f]{64}$/.test(digest))return json(response,400,{error:'invalid_request'});
   const nonce=randomBytes(32).toString('hex'),expires=Math.floor(Date.now()/1000)+300,message=messageFor(account,digest,nonce,expires);
   challenges.set(nonce,{account,digest,expires,message});return json(response,201,{account,digest,nonce,expires,chainId:46630,message});
  }
  if(request.method==='POST'&&url.pathname==='/v1/content/uploads'){
   const raw=await body(request),nonce=String(request.headers['x-upload-nonce']||''),signature=String(request.headers['x-upload-signature']||''),challenge=challenges.get(nonce);
   if(!challenge||challenge.expires<=Math.floor(Date.now()/1000)||createHash('sha256').update(raw).digest('hex')!==challenge.digest)return json(response,401,{error:'invalid_authorization'});
   const signer=(await recoverMessageAddress({message:challenge.message,signature})).toLowerCase();if(signer!==challenge.account)return json(response,401,{error:'invalid_authorization'});
   const details=JSON.parse(raw),uploadId=randomUUID(),accessToken=randomBytes(24).toString('hex');
   const metadata={name:details.name,symbol:details.symbol,description:details.description,image:details.image,properties:{x:details.x,website:details.website,creatorFeesToHolders:details.creatorFeesToHolders,creatorTaxBps:details.creatorTaxBps}};
   const cid=metadataCid(metadata);uploads.set(uploadId,{accessToken,status:'pending',metadata,cid});
   challenges.delete(nonce);return json(response,201,{uploadId,accessToken,imageUpload:null});
  }
  const complete=/^\/v1\/content\/uploads\/([0-9a-f-]{36})\/complete$/.exec(url.pathname);
  if(request.method==='POST'&&complete){const upload=uploads.get(complete[1]);if(!upload||request.headers.authorization!==`Bearer ${upload.accessToken}`)return json(response,401,{error:'unauthorized'});upload.status='ready';stored.set(upload.cid,upload.metadata);persist();return json(response,202,{uploadId:complete[1],status:'ready'});}
  const read=/^\/v1\/content\/uploads\/([0-9a-f-]{36})$/.exec(url.pathname);
  if(request.method==='GET'&&read){const upload=uploads.get(read[1]);if(!upload||request.headers.authorization!==`Bearer ${upload.accessToken}`)return json(response,401,{error:'unauthorized'});return json(response,200,{status:upload.status,metadataURI:`ipfs://${upload.cid}`,metadata:upload.metadata});}
  return json(response,404,{error:'not_found'});
 }catch(error){console.error(error);return json(response,500,{error:'local_metadata_failed'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local Creator metadata service: http://127.0.0.1:${port}`));
