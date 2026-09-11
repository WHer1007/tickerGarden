import type {TokenDetailResponse,TokenDetailSource} from './generated/read-api.ts';
export type DetailIdentity={marketId:`0x${string}`;memeToken:string;quoteAsset:string;quoteDecimals:number;symbol:string;quoteSymbol:string;createdAt?:number};
export type DetailPeriod='1H'|'12H'|'1D';
const periods:Record<DetailPeriod,[number,number]>={'1H':[3600,60],'12H':[43200,300],'1D':[86400,900]};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uint=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v);
const dec=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,100})(\.[0-9]{1,36})?$/.test(v);
const num=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const addr=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
export function scaledDecimal(s:string,places=36):bigint{const [a,b='']=s.split('.');return BigInt(a!)*10n**BigInt(places)+BigInt(b.padEnd(places,'0').slice(0,places)||'0');}
export function displayDecimal(value:string|null|undefined,places=8):string{if(!value||!dec(value))return '-';const [a,b='']=value.split('.');const fraction=b.slice(0,places).replace(/0+$/,'');if(a==='0'&&!fraction&&scaledDecimal(value)>0n)return `<${places?`0.${'0'.repeat(places-1)}1`:'1'}`;return `${a!.replace(/\B(?=(\d{3})+(?!\d))/g,',')}${fraction?'.'+fraction:''}`;}
export function circulatingCap(price:string|null|undefined,supply:string|null|undefined):string|null{if(!price||!dec(price)||!supply||!uint(supply))return null;const n=scaledDecimal(price)*BigInt(supply)/10n**18n;return `${n/10n**36n}.${(n%10n**36n).toString().padStart(36,'0')}`;}
export function validateTokenDetail(v:unknown,chain:number,id:DetailIdentity,period:DetailPeriod,now=Date.now()):TokenDetailResponse{
 const fail=():never=>{throw new Error('Detail analytics unavailable or inconsistent');};
 if(!obj(v)||v.version!==1||v.chainId!==chain||v.displayOnly!==true||v.marketId!==id.marketId||v.memeToken!==id.memeToken||v.quoteAsset!==id.quoteAsset||v.quoteDecimals!==id.quoteDecimals||v.period!==period||!obj(v.sources)||!obj(v.reasons))return fail();
 const [duration,interval]=periods[period];
 const source=(key:string):TokenDetailSource=>{const s=(v.sources as Record<string,unknown>)[key];if(!obj(s)||!['dune','indexer'].includes(String(s.provider))||!num(s.asOf)||s.asOf>now/1000+30||now/1000-s.asOf>1200||!uint(s.blockNumber)||!hash(s.blockHash)||(s.provider==='dune'&&(!uint(s.queryId)||typeof s.executionId!=='string'||!num(s.cachedAt))))return fail();return s as unknown as TokenDetailSource;};
 if(v.statistics!==null){const s=v.statistics,asOf=source('statistics').asOf;if(!obj(s)||s.volumeBasis!=='EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE'||!num(s.volumeTo)||s.volumeFrom!==s.volumeTo-86400||s.volumeTo>asOf||asOf-s.volumeTo>interval||(s.price!==null&&(!dec(s.price)||scaledDecimal(s.price)<=0n))||(s.volume24h!==null&&!dec(s.volume24h)))return fail();}
 if(v.chart!==null){const c=v.chart,asOf=source('chart').asOf;if(!obj(c)||!num(c.from)||!num(c.to)||c.from>=c.to||c.interval!==interval||c.from%interval||c.to%interval||c.to>asOf||asOf-c.to>interval||!Array.isArray(c.points)||c.points.length>2000||c.points.length!==(c.to-c.from)/interval||(duration&&c.to-c.from!==duration))return fail();for(const [i,p]of c.points.entries()){if(!obj(p)||p.timestamp!==c.from+i*interval||(p.price!==null&&(!dec(p.price)||scaledDecimal(p.price)<=0n)))return fail();}}
 if(v.holders!==null){const h=v.holders;source('holders');if(!obj(h)||h.basis!=='TOTAL_MINUS_KNOWN_PROTOCOL_BALANCES_V1'||!uint(h.totalSupplyRaw)||!uint(h.circulatingSupplyRaw)||BigInt(h.circulatingSupplyRaw)>BigInt(h.totalSupplyRaw)||!num(h.count)||!Array.isArray(h.items)||h.items.length>100||h.items.length>h.count)return fail();const seen=new Set<string>();let sum=0n,prev:bigint|null=null;for(const x of h.items){if(!obj(x)||!addr(x.account)||/^0x0{40}$/.test(x.account)||seen.has(x.account)||!uint(x.balanceRaw)||BigInt(x.balanceRaw)<=0n||(prev!==null&&BigInt(x.balanceRaw)>prev))return fail();seen.add(x.account);sum+=BigInt(x.balanceRaw);prev=BigInt(x.balanceRaw);}if(sum>BigInt(h.circulatingSupplyRaw))return fail();}
 if(v.trades!==null){const asOf=source('trades').asOf;if(!Array.isArray(v.trades)||v.trades.length>100)return fail();let prior=Infinity;const seen=new Set();for(const t of v.trades){if(!obj(t)||!num(t.timestamp)||t.timestamp>asOf||t.timestamp>prior||!['buy','sell'].includes(String(t.side))||!dec(t.price)||scaledDecimal(t.price)<=0n||!uint(t.memeRaw)||!uint(t.quoteRaw)||t.memeRaw==='0'||t.quoteRaw==='0'||!hash(t.txHash)||typeof t.eventKey!=='string'||!t.eventKey||seen.has(t.eventKey)||(t.actor!==null&&!addr(t.actor))||!['unclassified','internal_reward_conversion','internal_holder_conversion'].includes(String(t.classification)))return fail();prior=t.timestamp;seen.add(t.eventKey);}}
 if(v.fees!==null){source('fees');if(!Array.isArray(v.fees)||v.fees.length>8)return fail();const seen=new Set();for(const f of v.fees){if(!obj(f)||!['creator','stakers','platform','holders'].includes(String(f.recipient))||![id.memeToken,id.quoteAsset].includes(String(f.asset))||!uint(f.amountRaw)||seen.has(String(f.recipient)+f.asset))return fail();seen.add(String(f.recipient)+f.asset);}}
 return v as unknown as TokenDetailResponse;
}
export type FeeConfig={phase:number;stakingEnabled:boolean;holders:boolean;active:boolean|null;taxBps:number};
export function feeRows(config:FeeConfig):Array<{key:string;label:string;percent:number|null;note:string}>{
 const active=config.phase===1&&config.stakingEnabled?config.active:false;
 const creator=active===null?null:active?40:70;
 const rows=[{key:'creator',label:'Creator',percent:creator===null?null:config.holders?creator/2:creator,note:'Creator revenue'}];
 if(config.holders)rows.push({key:'holders',label:'Holders',percent:creator===null?null:creator/2,note:'Token holder rewards'});
 if(config.phase===1)rows.push({key:'stakers',label:'Stakers',percent:active===null?null:active?30:0,note:config.stakingEnabled?'STOCK staking rewards':'Staking disabled'});
 rows.push({key:'platform',label:'Platform',percent:30,note:'Supports TickerGarden'});return rows;
}
