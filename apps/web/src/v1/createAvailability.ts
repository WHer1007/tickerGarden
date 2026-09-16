export type CreateAvailability = {
 submitting: boolean; imageReading: boolean; imageReady: boolean; runtimeReady: boolean; runtimeReason: string;
 walletConnected: boolean; busy: boolean; pendingQuote: boolean; invalidField?: string;
 previewState?: "idle"|"loading"|"ready"|"error";
 metadataReady: boolean; buyMode: boolean; fundingReady: boolean; insufficientEth: boolean;
};
/** Explain every disabled state next to the action, including optional buy previews. */
export function createDisabledReason(s: CreateAvailability): string | null {
 if(s.submitting)return 'Launching…';
 if(s.imageReading)return 'Loading image…';
 if(!s.runtimeReady)return /expected finalized|read api|snapshot/i.test(s.runtimeReason) ? 'Market data is syncing. Please retry shortly.' : s.runtimeReason || 'Launch is not ready. Reload to retry.';
 if(!s.walletConnected)return 'Connect your wallet.';
 if(s.busy)return 'Complete the wallet request.';
 if(s.pendingQuote)return 'Select an active paired asset.';
 if(!s.imageReady)return 'Add a token image.';
 if(s.invalidField)return `Check ${s.invalidField}.`;
 if(!s.metadataReady)return 'Publishing unavailable. Try again later.';
 if(s.buyMode&&!s.fundingReady)return s.previewState==='loading'?'Calculating your launch cost…':s.previewState==='idle'?'Complete your token details to calculate the launch cost.':'Your launch cost could not be calculated. Try again.';
 if(s.insufficientEth)return 'Insufficient ETH';
 return null;
}

export type CreateNoticeLevel = 'info' | 'warning' | 'error';
/** Normal progress is informational; missing launch prerequisites need user action. */
export function createDisabledLevel(s: CreateAvailability): CreateNoticeLevel {
 if(s.submitting||s.imageReading)return 'info';
 if(!s.runtimeReady||!s.walletConnected)return 'error';
 if(s.busy||s.previewState==='loading')return 'info';
 return createDisabledReason(s) ? 'error' : 'info';
}

/** One readiness decision for the visible success state, including known payment blockers. */
export function createReady(s: CreateAvailability, hasPreview: boolean, missingDraftImage=false): boolean {
 return hasPreview && s.fundingReady && !missingDraftImage && createDisabledReason(s)===null;
}
