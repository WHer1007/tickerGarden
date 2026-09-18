import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import type {MarketReadModel,MarketPage,SyncStatus,ConfigReadModel} from '../../../openapi/generated/v1-client.ts';
import {runtimeConfigs} from '../../runtime-deployment/src/index.ts';
import {encodeCursor,decodeCursor,PublicationChangedError} from '../../read-store/src/index.ts';

type Reader=Pick<Pool,'query'>;
export interface ExploreReadInput {pool:Reader;deployment:DeploymentIdentity;schemaName?:string}
function context(input:ExploreReadInput){
 const name=input.schemaName??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('invalid schema');
 return {s:`"${name}"`,id:[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest]};
}
export async function readExploreBootstrap(input:ExploreReadInput){
 const {s,id}=context(input);
 const head=(await input.pool.query<{number:string;hash:`0x${string}`}>(`SELECT block_number::text number,block_hash hash FROM (
 SELECT block_number,block_hash FROM ${s}.confirmed_display_cursor WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3
 UNION ALL SELECT block_number,block_hash FROM ${s}.recent_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND canonical AND expires_at>now()
 ) h ORDER BY block_number DESC LIMIT 1`,id)).rows[0];
 const sync:SyncStatus={chainId:input.deployment.chainId,status:head?'synced':'unavailable',finality:head?'head':'unavailable',blockNumber:head?.number??null,blockHash:head?.hash??null,headBlockNumber:head?.number??null,headBlockHash:head?.hash??null,lagBlocks:head?'0':null,revision:head?`${head.number}:${head.hash}`:'explore-empty'};
 return {displayOnly:true as const,configs:runtimeConfigs as readonly ConfigReadModel[],sync};
}
export async function readExploreCards(input:ExploreReadInput,markets:string[]){
 if(!markets.length||markets.length>100||markets.some(m=>!/^0x[0-9a-f]{64}$/.test(m)))throw Error('invalid markets');
 const {s,id}=context(input);
 const rows=await input.pool.query<{payload:MarketReadModel}>(`SELECT payload FROM ${s}.explore_display_cards WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=ANY($4::text[])`,[...id,[...new Set(markets)]]);
 return {chainId:input.deployment.chainId,displayOnly:true as const,items:rows.rows.map(r=>r.payload)};
}
export async function readExplorePage(input:ExploreReadInput&{secret:string;query:Record<string,string>}):Promise<MarketPage>{
 const q=input.query,allowed=['launchPhase','sort','search','assetUid','limit','cursor','stakingEnabled'];
 if(Object.keys(q).some(k=>!allowed.includes(k)))throw Error('invalid query');
 const sort=q.sort??'createdAt_desc',phase=q.launchPhase??null,search=(q.search??'').trim(),asset=q.assetUid||null,limit=Number(q.limit??40);
 if(!['createdAt_desc','createdAt_asc','marketCapUsd_desc','recentBuy_desc'].includes(sort)||phase!==null&&!['0','1'].includes(phase)||search.length>120||asset!==null&&!/^0x[0-9a-f]{64}$/.test(asset)||!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid query');
 if(q.stakingEnabled!==undefined&&!['true','false'].includes(q.stakingEnabled))throw Error('invalid query');
 const staking=q.stakingEnabled??null;
 const filterDigest=createHash('sha256').update(JSON.stringify({sort,phase,search,asset,staking})).digest('hex');
 const after=q.cursor?decodeCursor(q.cursor,{scope:'explore-display',filterDigest,...(sort!=='marketCapUsd_desc'?{revision:sort}:{})},input.secret):undefined;
 if(after&&(!/^-?[0-9]+$/.test(after.sortKey)||!/^0x[0-9a-f]{64}$/.test(after.identity)))throw new PublicationChangedError('invalid cursor');
 const {s,id}=context(input);
 let version=sort,updatedAt:string|null=null;
 if(sort==='marketCapUsd_desc'){
  const snapshot=(await input.pool.query<{version:string;created_at:Date|string}>(`SELECT version,created_at FROM ${s}.explore_cap_snapshots WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND ($4::text IS NULL OR version=$4) ORDER BY scheduled_at DESC,created_at DESC LIMIT 1`,[...id,after?.revision??null])).rows[0];
  if(after&&!snapshot)throw new PublicationChangedError('ranking page changed');
  version=snapshot?.version??'pending';updatedAt=snapshot?new Date(snapshot.created_at).toISOString():null;
 }
 const created="coalesce((c.payload->'identity'->>'deployedAt')::numeric,0)";
 const position="coalesce((c.payload->'lastBuy'->>'blockNumber')::numeric*18446744073709551616+(c.payload->'lastBuy'->>'transactionIndex')::numeric*4294967296+(c.payload->'lastBuy'->>'logIndex')::numeric,0)";
 // New markets enter immediately, ahead of the last frozen cap snapshot.
 const key=sort==='createdAt_asc'?`-${created}`:sort==='recentBuy_desc'?position:sort==='marketCapUsd_desc'?`coalesce(-r.rank::numeric,${created})`:created;
 const records=await input.pool.query<{market_id:string;payload:MarketReadModel;sort_key:string}>(`WITH page AS (
 SELECT c.market_id,c.payload,${key} sort_key FROM ${s}.explore_display_cards c
 ${sort==='marketCapUsd_desc'?`LEFT JOIN LATERAL (SELECT rank FROM ${s}.explore_cap_ranks ranked WHERE ranked.environment=$1 AND ranked.chain_id=$2 AND ranked.deployment_digest=$3 AND ranked.market_id=c.market_id AND ranked.version=$4 LIMIT 1) r ON true`:''}
 WHERE c.environment=$1 AND c.chain_id=$2 AND c.deployment_digest=$3 AND $4::text IS NOT NULL
 AND ${sort==='recentBuy_desc'?`${position}>0`:'true'}
 AND ($5::text IS NULL OR c.payload->>'launchPhase'=$5) AND ($6::text IS NULL OR c.payload->>'assetUid'=$6)
 AND ($11::text IS NULL OR coalesce((c.payload->>'stakingEnabled')::boolean,c.payload->>'gauge'<>'0x0000000000000000000000000000000000000000')=($11::boolean))
 AND ($7::text='' OR position(lower($7) IN lower(concat(c.payload->'identity'->>'name',' ',c.payload->'identity'->>'symbol',' ',c.payload->>'memeToken',' ',c.market_id)))>0)
 ) SELECT market_id,payload,sort_key::text FROM page
 WHERE $8::numeric IS NULL OR sort_key<$8 OR (sort_key=$8 AND market_id>$9)
 ORDER BY page.sort_key DESC,market_id LIMIT $10`,[...id,version,phase,asset,search,after?.sortKey??null,after?.identity??null,limit+1,staking]);
 const selected=records.rows.slice(0,limit),last=selected.at(-1),{sync}=await readExploreBootstrap(input);
 return {items:selected.map(r=>r.payload),sync,nextCursor:records.rows.length>limit&&last?encodeCursor({scope:'explore-display',revision:version,filterDigest,sortKey:last.sort_key,identity:last.market_id},input.secret):null,
 ...(['createdAt_desc','createdAt_asc'].includes(sort)?{}:{ranking:{mode:sort==='marketCapUsd_desc'?'market-cap-snapshot' as const:'recent-buys' as const,version,updatedAt,refreshSeconds:sort==='marketCapUsd_desc'?1200:0,stale:false}})};
}
