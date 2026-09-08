export type CreateAvailability = {
 submitting: boolean; imageReading: boolean; runtimeReady: boolean; runtimeReason: string;
 walletConnected: boolean; busy: boolean; pendingQuote: boolean; invalidField?: string;
 metadataReady: boolean; buyMode: boolean; fundingReady: boolean; insufficientEth: boolean;
};
/** Explain every disabled state next to the action, including optional buy previews. */
export function createDisabledReason(s: CreateAvailability): string | null {
 if(s.submitting)return 'Waiting for the launch transaction…';
 if(s.imageReading)return 'Wait for the token image to finish loading.';
 if(!s.runtimeReady)return s.runtimeReason || 'Launch settings are unavailable. Reload the current integration page.';
 if(!s.walletConnected)return 'Connect your wallet to continue.';
 if(s.busy)return 'Finish the current wallet operation to continue.';
 if(s.pendingQuote)return 'Choose an activated paired asset.';
 if(s.invalidField)return `Complete or correct ${s.invalidField} to continue.`;
 if(!s.metadataReady)return 'Token detail storage is unavailable.';
 if(s.buyMode&&!s.fundingReady)return 'Developer buy preview is unavailable. Check the preview message, or clear Developer buy to launch without buying.';
 if(s.buyMode&&s.insufficientEth)return 'Insufficient ETH for the developer buy, launch fee and gas.';
 return null;
}
