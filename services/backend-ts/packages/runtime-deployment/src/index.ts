import {productionRuntime} from './production.generated.ts';
import {f72BootstrapConfigs} from '../../config-projector/src/f72-bootstrap.generated.ts';

// Each process serves exactly one frozen deployment. Changing environment requires a restart.
export function selectRuntimeChain(env:Readonly<Record<string,string|undefined>>):4663|46630 {
 const production=env.TG_ENVIRONMENT==='production'||env.VERCEL_ENV==='production';
 if(env.TG_ENVIRONMENT&& !['test','preview','production'].includes(env.TG_ENVIRONMENT))throw Error('Unsupported runtime environment');
 if(env.VERCEL_ENV==='production'&&env.TG_ENVIRONMENT!=='production')throw Error('Production runtime environment must be explicit');
 const chain=production?4663:46630;
 if(env.TG_CHAIN_ID&&env.TG_CHAIN_ID!==String(chain))throw Error('Runtime chain/environment mismatch');
 return chain;
}
export const CURRENT_CHAIN_ID=selectRuntimeChain(process.env);
export const IS_PRODUCTION=CURRENT_CHAIN_ID===4663;
export const runtimeConfigs=IS_PRODUCTION?productionRuntime.configs:f72BootstrapConfigs;
export const runtimeReleaseId=IS_PRODUCTION?productionRuntime.releaseId:'0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2';
export const runtimeActivationBlock=IS_PRODUCTION?BigInt(productionRuntime.activationBlock):118689839n;
export const runtimeActivationHash=IS_PRODUCTION?productionRuntime.activationHash:'0x9b368b4107601d7abc1de430d89b30ac21bc3688a76ca83035bbce3bca56a63d';
export const runtimeGenesisHash=IS_PRODUCTION?productionRuntime.genesisHash:'0x829a42e6d68c872aafcef3abb2123fe371138fc415dd8b44381bbbf23049dd32';
function source(module:string){const value=module==='UniswapV4PoolManager'?productionRuntime.poolManager:productionRuntime.runtime[module];if(!value)throw Error('Missing production module '+module);return value;}
export function runtimeAddress(module:string,testAddress:`0x${string}`):`0x${string}`{return IS_PRODUCTION?source(module).address:testAddress;}
export function runtimeCodeHash(module:string,testHash:`0x${string}`):`0x${string}`{return IS_PRODUCTION?source(module).codeHash:testHash;}

export function assertRuntimeEnvironment(env:Readonly<Record<string,string|undefined>>):void {if(selectRuntimeChain(env)!==CURRENT_CHAIN_ID)throw Error('Configured environment differs from the process deployment');}
