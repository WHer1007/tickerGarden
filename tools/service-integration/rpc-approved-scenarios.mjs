import fs from 'node:fs';
import {keccak256,parseTransaction,recoverTransactionAddress} from '../../apps/web/node_modules/viem/_esm/index.js';
// Opt-in, temporary exact signed-intent capability for authorized testnet scenarios.
export class ApprovedScenarios {
 constructor(path){this.path=path;this.load();}
 load(){const stat=fs.lstatSync(this.path);if(stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Unsafe scenario capability file');const p=JSON.parse(fs.readFileSync(this.path));if(p.chainId!==46630||p.scope!=='AUTHORIZED_TESTNET_SCENARIOS'||!Array.isArray(p.transactions)||p.transactions.length>400||!Array.isArray(p.senders)||p.senders.length>12||p.expiresAt>Date.now()/1000+86400)throw Error('Invalid scenario capability');return p;}
 async permits(method,params){const p=this.load();if(p.expiresAt<Date.now()/1000)return false;
 if(method==='eth_blockNumber')return true;
 if(method==='eth_getTransactionCount'&&['pending','latest'].includes(params[1]))return p.senders.includes(params[0]?.toLowerCase());
 if(['eth_getTransactionReceipt','eth_getTransactionByHash'].includes(method))return p.transactions.some(r=>r.hash===params[0]);
 if(method==='eth_sendRawTransaction'){const hash=keccak256(params[0]),row=p.transactions.find(r=>r.hash===hash);if(!row)return false;const t=parseTransaction(params[0]),sender=(await recoverTransactionAddress({serializedTransaction:params[0]})).toLowerCase();if(t.chainId!==46630||sender!==row.from||!p.senders.includes(sender)||BigInt(t.value??0)>1000000000000000000n||BigInt(t.gas??0)*BigInt(t.maxFeePerGas??t.gasPrice??0)>10000000000000000n)throw Error('Scenario intent outside budget');return true;}
 return false;
 }
}
