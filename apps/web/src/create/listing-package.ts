/** Confirmed, user-downloadable launch details. This module performs no RPC or network access. */
export type ListingPackageSnapshot = Readonly<{
  chainId: number;
  chainName: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  logo: string;
  website: string;
  x: string;
  metadataURI: string;
  txHash: string;
}>;

export type ListingSubmissionLink = Readonly<{
  platform: string;
  url: string;
  label: string;
}>;

/** Official submission guidance links; availability and chain support are platform decisions. */
export const LISTING_SUBMISSION_LINKS: readonly ListingSubmissionLink[] = [
  { platform: 'Blockscout', url: 'https://docs.blockscout.com/using-blockscout/overviews/token-info', label: 'Submission guidance' },
  { platform: 'CoinGecko', url: 'https://support.coingecko.com/hc/en-us/articles/7291312302617-How-to-List-a-New-Cryptocurrency-on-CoinGecko', label: 'Submission guidance' },
  { platform: 'DEXScreener', url: 'https://docs.dexscreener.com/token-listing', label: 'Submission guidance' },
];

export function createListingPackage(snapshot: ListingPackageSnapshot): ListingPackageSnapshot {
  return { ...snapshot };
}

export function serializeListingPackageJSON(snapshot: ListingPackageSnapshot): string {
  return JSON.stringify({ ...snapshot, submissionGuidance: LISTING_SUBMISSION_LINKS }, null, 2) + '\n';
}

export function serializeListingPackageText(snapshot: ListingPackageSnapshot): string {
  const lines = [
    'TickerGarden token listing information',
    '',
    `Chain: ${snapshot.chainName} (${snapshot.chainId})`,
    `Token address: ${snapshot.tokenAddress}`,
    `Name: ${snapshot.name}`,
    `Symbol: ${snapshot.symbol}`,
    `Logo: ${snapshot.logo}`,
    `Website: ${snapshot.website}`,
    `X: ${snapshot.x}`,
    `Metadata URI: ${snapshot.metadataURI}`,
    `Transaction hash: ${snapshot.txHash}`,
    '',
    'External platform submission guidance (does not guarantee support or listing):',
    ...LISTING_SUBMISSION_LINKS.map(link => `${link.platform} — ${link.label}: ${link.url}`),
    '',
  ];
  return lines.join('\n');
}

/** Browser persistence is display-only and never used to authorize a transaction. */
export function parseSavedListing(raw: string | null, chainId: number): {snapshot:ListingPackageSnapshot;marketId:string} | null {
 if(!raw || raw.length>20000)return null;
 try{
  const v=JSON.parse(raw);const s=v.snapshot;
  if(!s||s.chainId!==chainId||!/^0x[a-fA-F0-9]{64}$/.test(v.marketId)||!/^0x[a-fA-F0-9]{40}$/.test(s.tokenAddress)||!/^0x[a-fA-F0-9]{64}$/.test(s.txHash))return null;
  if(!['chainName','name','symbol','logo','website','x','metadataURI'].every(k=>typeof s[k]==='string'&&s[k].length<=2048))return null;
  return {snapshot:s,marketId:v.marketId};
 }catch{return null;}
}
