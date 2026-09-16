import type { Address } from 'viem';
import type { ConfigReadModel, SyncStatus } from './readApi.ts';
import type { CanonicalRuntimeBindings } from './chainBindings.ts';
import type { V1ContractAddresses } from './runtimeConfig.ts';
export interface IntegrationBootstrap {
 version: 1; chainId: 46630; releaseId: string; status: 'DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY';
 factory: Address; bindings: CanonicalRuntimeBindings; configs: ConfigReadModel[];
 assets: ConfigReadModel[]; initialMarkets: []; launchFee: string;
}
const hash=/^0x[0-9a-f]{64}$/,address=/^0x[0-9a-f]{40}$/;
/** Explicit test deployment input; never a financial or finalized snapshot. */
export function parseIntegrationBootstrap(raw: unknown,chain: number,contracts: V1ContractAddresses): IntegrationBootstrap {
 const b=raw as IntegrationBootstrap;
 if(chain!==46630||b?.version!==1||b.chainId!==chain||b.status!=='DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY'||!hash.test(b.releaseId)||b.factory!==contracts.factoryAddress)throw Error('Integration deployment mismatch');
 if(!b.bindings||Object.values(b.bindings).length!==8||Object.values(b.bindings).some(a=>!address.test(a)||/^0x0+$/.test(a))||b.bindings.launchRouter!==contracts.launchRouterAddress||b.bindings.protocolFeeVault!==contracts.protocolFeeVaultAddress||b.bindings.allocationManager!==contracts.allocationManagerAddress)throw Error('Integration bindings mismatch');
 if(!Array.isArray(b.configs)||!Array.isArray(b.assets)||!Array.isArray(b.initialMarkets)||b.initialMarkets.length!==0||!/^\d+$/.test(b.launchFee))throw Error('Invalid integration configuration');
 for(const c of b.configs){if(!['quote','baseline','template'].includes(c.kind)||!hash.test(c.id)||c.status!==1||!c.values||c.source?.chainId!==chain||!hash.test(c.source.blockHash)||!hash.test(c.source.transactionHash))throw Error('Invalid deployment config evidence');}
 for(const c of b.assets){if(c.kind!=='asset'||!hash.test(c.id)||c.status!==1||!c.values||!address.test(String(c.values.stockToken))||!address.test(String(c.values.userStockVault))||!Number.isInteger(c.values.tokenDecimals)||Number(c.values.tokenDecimals)<6||Number(c.values.tokenDecimals)>18||!/^\d+$/.test(String(c.values.minimumAllocation))||BigInt(String(c.values.minimumAllocation))<414n||c.source?.chainId!==chain||!hash.test(c.source.blockHash)||!hash.test(c.source.transactionHash))throw Error('Invalid stock admission evidence');}
 for(const kind of ['quote','baseline','template'])if(!b.configs.some(c=>c.kind===kind))throw Error('Incomplete deployment configuration');
 return Object.freeze(b);
}
export function bootstrapSync(b: IntegrationBootstrap): SyncStatus {
 return {chainId:b.chainId,status:'unavailable',finality:'unavailable',blockNumber:null,blockHash:null,headBlockNumber:null,headBlockHash:null,lagBlocks:null,revision:`deployment:${b.releaseId}`};
}
