import {bscPublicEnvironment,bscStakingAssets} from './bsc/generated.ts';
import {isFrontendAssetOpen} from './asset-availability.ts';

export const bscStockCount = bscStakingAssets.filter(asset=>asset.enabled&&isFrontendAssetOpen(56,asset.tokenAddress)).length;
/** Public address references reuse the registered deployment projection. */
export const bscDocsContracts = [
 ['Market factory',bscPublicEnvironment.VITE_BSC_FACTORY_ADDRESS,'Creates community tokens and their markets.'],
 ['Launch and buy router',bscPublicEnvironment.VITE_BSC_LAUNCH_ROUTER_ADDRESS,'Combines token creation with an optional first purchase.'],
 ['Staking allocation manager',bscPublicEnvironment.VITE_BSC_ALLOCATION_MANAGER_ADDRESS,'Assigns Stock principal to eligible markets and handles exits.'],
 ['Protocol fee vault',bscPublicEnvironment.VITE_BSC_PROTOCOL_FEE_VAULT_ADDRESS,'Accounts for trading fees and pays reward shares.'],
 ['Holder rewards distributor',bscPublicEnvironment.VITE_BSC_TREASURY_DISTRIBUTOR_ADDRESS,'Holder infrastructure; claiming is not open in the BSC app.'],
 ['Creator revenue registry',bscPublicEnvironment.VITE_BSC_CREATOR_REVENUE_REGISTRY_ADDRESS,'Records creator fee beneficiaries and accepted handoffs.'],
].map(([name,address,description])=>({name:name!,address:address!,description:description!}));
