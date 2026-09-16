import { decodeFunctionResult, parseAbi, type Hex } from 'viem';
const config = 'bytes32 assetUid,bytes32 tickerGardenBaselineId,bytes32 quoteAssetConfigId,bytes32 launchTemplateId,bytes32 feePolicyId,bytes32 executionSpecId,bytes32 expectedEconomics,uint256 launchConfigId,address creatorRevenueBeneficiaryAtCreation,address memeToken,address curve,address gauge,address quoteAsset,address graduatedHook,uint16 creatorTaxBps,bool creatorFeesToHolders,bool stakingEnabled';
const runtime = '(bytes32 poolId,uint32 sourceVersion,uint8 launchPhase) runtime';
export const legacyMarketRecordAbi = parseAbi([`function market(bytes32) view returns (((${config}) config,${runtime}) value)`]);
export const burnMarketRecordAbi = parseAbi([`function market(bytes32) view returns (((${config},bool burnMemeFees) config,${runtime}) value)`]);
export const lpMarketRecordAbi = parseAbi([`function market(bytes32) view returns (((${config},bool burnMemeFees,uint24 lpFeePips) config,${runtime}) value)`]);
/** Static return widths distinguish deployed legacy markets from the settlement-burn release. */
export function decodeMarketRecord(raw: Hex) {
  if (raw.length === 2 + 22 * 64) return decodeFunctionResult({abi:lpMarketRecordAbi,functionName:'market',data:raw});
  if (raw.length === 2 + 21 * 64) {
    const value=decodeFunctionResult({abi:burnMarketRecordAbi,functionName:'market',data:raw});
    return {...value,config:{...value.config,lpFeePips:0}};
  }
  if (raw.length === 2 + 20 * 64) {
    const value=decodeFunctionResult({abi:legacyMarketRecordAbi,functionName:'market',data:raw});
    return {...value,config:{...value.config,burnMemeFees:false,lpFeePips:0}};
  }
  throw new Error('Unsupported market record encoding');
}
