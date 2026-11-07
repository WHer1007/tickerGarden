import {formatUnits} from 'viem';
/** Published RH/BSC Factory fee; prefer the fee already read for transaction preparation. */
export const FIXED_LAUNCH_FEE_WEI = 500_000_000_000_000n;
export const FIXED_LAUNCH_FEE_LABEL = '0.0005 ETH';
export function launchFeeLabel(nativeSymbol: string, feeWei = FIXED_LAUNCH_FEE_WEI): string {
 return `${formatUnits(feeWei,18)} ${nativeSymbol}`;
}
