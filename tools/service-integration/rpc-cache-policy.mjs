const HASH=/^0x[0-9a-f]{64}$/;
export const readMethods=new Set(['eth_chainId','eth_blockNumber','eth_getTransactionByHash','eth_getBlockByNumber','eth_getBlockByHash','eth_getBlockReceipts','eth_getLogs','eth_getTransactionReceipt','eth_getCode','eth_call','eth_getBalance','eth_getStorageAt','eth_getTransactionCount','eth_gasPrice','eth_estimateGas','eth_maxPriorityFeePerGas']);
// Receipt-by-transaction lookups may change after reorg. Only the finalized
// prefetch path can cache those after cross-checking the containing header.
export function fixedRead(method,params,finalized){
 if(method==='eth_getBlockByHash'||method==='eth_getBlockReceipts')return HASH.test(params[0]);
 if(method==='eth_getLogs')return HASH.test(params[0]?.blockHash??'');
 if(['eth_call','eth_getCode','eth_getBalance'].includes(method))return HASH.test(params[1]?.blockHash??'');
 return method==='eth_getBlockByNumber'&&typeof params[0]==='string'&&/^0x[0-9a-f]+$/.test(params[0])&&BigInt(params[0])<=BigInt(finalized);
}
