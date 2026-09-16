import fs from 'node:fs';
import {keccak256,parseTransaction,recoverTransactionAddress} from '../../apps/web/node_modules/viem/_esm/index.js';
// Optional, explicitly configured deployment capability. Normal relay stays read-only.
export class ApprovedDeployment {
 constructor(path, additional, hashes=[]){const batch=JSON.parse(fs.readFileSync(path));if(batch.chain!==46630||batch.transactions.length!==19)throw Error('Invalid approved deployment');this.rows=batch.transactions.map(x=>x.transaction);if(additional){const extra=JSON.parse(fs.readFileSync(additional));if(extra.chain!==46630||extra.scope!=='REVIEWED_TESTNET_INITIALIZATION'||extra.transactions.length>5||extra.transactions.some(x=>x.transaction.from.toLowerCase()!==this.rows[0].from.toLowerCase()))throw Error('Invalid initialization scope');this.rows.push(...extra.transactions.map(x=>x.transaction));}this.hashes=new Set(hashes);}
 matches(t,sender){return this.rows.some(r=>r.from.toLowerCase()===sender?.toLowerCase()&&String(r.to??'').toLowerCase()===String(t.to??'').toLowerCase()&&(t.data??t.input)===r.input&&BigInt(t.value??0)===0n&&(t.nonce===undefined||BigInt(t.nonce)===BigInt(r.nonce)));}
 async permits(method,p){
  if(method==='eth_blockNumber')return true;
  if(method==='eth_getTransactionCount'&&p[1]==='pending')return this.rows.some(r=>r.from.toLowerCase()===p[0]?.toLowerCase());
  if(method==='eth_estimateGas')return this.matches(p[0],p[0].from);
  if(['eth_getTransactionReceipt','eth_getTransactionByHash'].includes(method))return this.hashes.has(p[0]);
  if(method==='eth_sendRawTransaction'){
   const t=parseTransaction(p[0]);if(t.chainId!==46630||!this.matches(t,await recoverTransactionAddress({serializedTransaction:p[0]})))throw Error('Transaction outside approved deployment');
   if(BigInt(t.gas??0)*BigInt(t.gasPrice??t.maxFeePerGas??0)>20000000000000000n)throw Error('Transaction fee cap exceeded');
   this.hashes.add(keccak256(p[0]));return true;
  }
  return false;
 }
}
