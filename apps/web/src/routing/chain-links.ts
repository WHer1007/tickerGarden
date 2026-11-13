/** Public links carry their chain identity before any click handler runs. */
export function chainHref(path: string, chainId: number): string {
 if (!path.startsWith('/') || path.startsWith('//')) return path;
 const url = new URL(path, 'https://tickergarden.com');
 if (!url.searchParams.has('chain')) url.searchParams.set('chain', chainId === 56 ? 'bsc' : 'rh');
 return url.pathname + url.search + url.hash;
}

export function marketHref(marketId: string, chainId: number): string {
 if (!/^0x[0-9a-f]{64}$/i.test(marketId)) throw Error('Invalid market identity');
 return chainHref(`/trade?marketId=${marketId.toLowerCase()}`, chainId);
}

export function scopeChainLinks(root: ParentNode, chainId: number): void {
 for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
  link.setAttribute('href', chainHref(link.getAttribute('href')!, chainId));
 }
}
