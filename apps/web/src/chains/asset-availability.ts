/** Product listing policy only; never changes registry admission or recovery rights. */
const closedAssets = new Map<number, ReadonlySet<string>>([
  [56, new Set(['0x1ecfda023c46ca216b5c620ef357a6d0c03951e6'])], // GPROB
]);

export function isFrontendAssetOpen(chainId: number, token: string): boolean {
  return !closedAssets.get(chainId)?.has(token.toLowerCase());
}

export function assertFrontendAssetOpen(chainId: number, token: string): void {
  if (!isFrontendAssetOpen(chainId, token)) throw new Error('This asset is not available on the platform. Choose another asset.');
}
