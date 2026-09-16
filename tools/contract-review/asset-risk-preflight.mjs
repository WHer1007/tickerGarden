import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { keccak_256 } from '../../deployments/node_modules/@noble/hashes/sha3.js';
const hash = x => '0x'+Buffer.from(keccak_256(x)).toString('hex');
const selector = s => hash(Buffer.from(s)).slice(0,10);
const slot = s => '0x'+(BigInt(hash(Buffer.from(s)))-1n).toString(16).padStart(64,'0');
const zero = '0x'+'0'.repeat(40);
const address = x => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(x)) throw Error('Invalid address');
  return x.toLowerCase();
};
const slotAddress = x => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(x) || BigInt('0x'+x.slice(2,26)) !== 0n) throw Error('Invalid address word');
  return address('0x'+x.slice(-40));
};
export function verifyAssetObservation(expected, observed) {
  if (!['direct','erc1967','beacon'].includes(expected.kind)) throw Error('Unsupported proxy kind');
  const fields = ['asset','kind','codeHash','decimals','implementation','admin','beacon'];
  if (expected.kind !== 'direct') fields.push('implementationCodeHash');
  if (expected.kind === 'beacon') fields.push('beaconCodeHash');
  for (const key of fields) {
    if (typeof expected[key] !== 'string' || expected[key].toLowerCase() !== observed[key]?.toLowerCase()) {
      throw Error('Asset identity mismatch: '+key);
    }
  }
  if (expected.kind === 'direct' && (observed.implementation !== zero || observed.beacon !== zero || observed.admin !== zero)) throw Error('Proxy declared direct');
  if (expected.kind === 'erc1967' && (observed.implementation === zero || observed.beacon !== zero)) throw Error('Invalid ERC1967 identity');
  if (expected.kind === 'beacon' && (observed.implementation === zero || observed.beacon === zero)) throw Error('Invalid beacon identity');
}
export function coverage(balance, liability) {
  if (![balance,liability].every(x=>typeof x==='string' && /^(0|[1-9][0-9]*)$/.test(x))) throw Error('Invalid coverage integers');
  const b=BigInt(balance), l=BigInt(liability);
  return {balance,liability,deficit:(l>b?l-b:0n).toString(),surplus:(b>l?b-l:0n).toString()};
}
/** Manual read-only backend/deployment preflight. All reads pinned; no signing or scheduler. */
export async function inspectAssetRisks(reference, rpc) {
  if (!Array.isArray(reference.assets) || !Array.isArray(reference.vaultAssets ?? []) ||
      reference.assets.length + (reference.vaultAssets?.length ?? 0) === 0) throw Error('Empty risk reference');
  if (BigInt(await rpc('eth_chainId',[])).toString() !== reference.chainId) throw Error('Wrong chain');
  const block = await rpc('eth_getBlockByNumber',['finalized',false]);
  if (!/^0x[0-9a-fA-F]{64}$/.test(block?.hash) || !/^0x[0-9a-fA-F]+$/.test(block?.number)) throw Error('Finalized block unavailable');
  const tag=block.number;
  const codeHash = async target => {
    const code=await rpc('eth_getCode',[target,tag]);
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw Error('Missing code');
    return hash(Buffer.from(code.slice(2),'hex'));
  };
  const call = (to,data) => rpc('eth_call',[{to,data},tag]);
  const assets=[];
  for (const expected of reference.assets) {
    const asset=address(expected.asset);
    const storage = async name => slotAddress(await rpc('eth_getStorageAt',[asset,slot('eip1967.proxy.'+name),tag]));
    let implementation=await storage('implementation'), beacon=await storage('beacon'), admin=await storage('admin');
    if (expected.kind === 'beacon') {
      if (implementation !== zero) throw Error('Ambiguous implementation and beacon');
      implementation=slotAddress(await call(beacon,selector('implementation()')));
    }
    const observed={asset,kind:expected.kind,codeHash:await codeHash(asset),
      decimals:BigInt(await call(asset,selector('decimals()'))).toString(),implementation,admin,beacon};
    if (implementation !== zero) observed.implementationCodeHash=await codeHash(implementation);
    if (beacon !== zero) observed.beaconCodeHash=await codeHash(beacon);
    verifyAssetObservation(expected,observed);
    assets.push(observed);
  }
  const vaults=[];
  for (const entry of reference.vaultAssets ?? []) {
    const vault=address(entry.vault), asset=address(entry.asset);
    const balance=asset===zero ? await rpc('eth_getBalance',[vault,tag]) :
      await call(asset,selector('balanceOf(address)')+vault.slice(2).padStart(64,'0'));
    const liability=await call(vault,selector('totalLiability(address)')+asset.slice(2).padStart(64,'0'));
    vaults.push({vault,asset,...coverage(BigInt(balance).toString(),BigInt(liability).toString())});
  }
  const final=await rpc('eth_getBlockByNumber',[tag,false]);
  if (final?.hash !== block.hash) throw Error('Pinned block changed');
  return {chainId:reference.chainId,blockNumber:tag,blockHash:block.hash,assets,vaults,
    status:vaults.some(x=>x.deficit!=='0')?'ASSET_DEFICIT':'REFERENCE_MATCH_AT_BLOCK'};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || !process.env.ASSET_AUDIT_RPC_URL) throw Error('Need reference JSON and ASSET_AUDIT_RPC_URL');
  let id=0;
  const rpc=async(method,params)=>{
    const response=await fetch(process.env.ASSET_AUDIT_RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('RPC HTTP failure');
    const data=await response.json();
    if (data.error || data.result===undefined) throw Error('RPC read failed: '+method);
    return data.result;
  };
  const result=await inspectAssetRisks(JSON.parse(readFileSync(process.argv[2],'utf8')),rpc);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if (result.status==='ASSET_DEFICIT') process.exitCode=1;
}
