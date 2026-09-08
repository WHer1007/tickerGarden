// Only complete, bare file CIDs returned by the configured publisher are supported.
export function isIPFSFileURI(value: string): boolean {
 return /^ipfs:\/\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})$/.test(value);
}
export function ipfsGatewayURL(uri: string, gateway?: string): string | null {
 if (!isIPFSFileURI(uri) || !gateway) return null;
 try { const url=new URL(gateway); if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;
 return `${url.origin}/ipfs/${uri.slice(7)}`; } catch { return null; }
}
