export type CreatorMarket = {
  marketId: string;
  memeToken: string;
  creator: string;
  creationBlockNumber: string;
};

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const MARKET_ID = /^0x[0-9a-f]{64}$/i;
const BLOCK = /^[1-9][0-9]*$/;

function invalid(): never { throw new Error('Invalid creator market directory response'); }

function validatePage(value: unknown, chainId: number, account: string, seen: Set<string>): { items: CreatorMarket[]; nextCursor: string | null; complete: boolean } {
  if (!value || typeof value !== 'object') return invalid();
  const page = value as Record<string, unknown>;
  if (page.chainId !== chainId || page.displayOnly !== true || typeof page.complete !== 'boolean' || typeof page.address !== 'string' || !ADDRESS.test(page.address) || page.address.toLowerCase() !== account) return invalid();
  if (!Array.isArray(page.items) || page.items.length > 100) return invalid();
  if (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || page.nextCursor.length === 0)) return invalid();
  const items: CreatorMarket[] = [];
  for (const raw of page.items) {
    if (!raw || typeof raw !== 'object') return invalid();
    const item = raw as Record<string, unknown>;
    if (typeof item.marketId !== 'string' || !MARKET_ID.test(item.marketId) || seen.has(item.marketId.toLowerCase()) ||
        typeof item.memeToken !== 'string' || !ADDRESS.test(item.memeToken) ||
        typeof item.creator !== 'string' || !ADDRESS.test(item.creator) || item.creator.toLowerCase() !== account ||
        typeof item.creationBlockNumber !== 'string' || !BLOCK.test(item.creationBlockNumber)) return invalid();
    seen.add(item.marketId.toLowerCase());
    items.push({ marketId: item.marketId, memeToken: item.memeToken, creator: item.creator, creationBlockNumber: item.creationBlockNumber });
  }
  return { items, nextCursor: page.nextCursor as string | null, complete: page.complete };
}

export async function loadCreatorMarketPage(baseUrl:string,chainId:number,account:string,signal?:AbortSignal,cursor?:string,seen:Iterable<string>=[]){
 if(!Number.isInteger(chainId)||!ADDRESS.test(account))return invalid();
 const normalized=account.toLowerCase();
 const raw=await new TickerGardenV1Client(baseUrl,(input,init)=>fetch(input,{...init,signal})).listCreatorMarkets({address:normalized as `0x${string}`,limit:50,...(cursor?{cursor}:{})});
 const page=validatePage(raw,chainId,normalized,new Set(seen));if(!page.complete)throw Error('Creator Directory Updating');
 if(cursor&&page.nextCursor===cursor)throw Error('Invalid continuation');return page;
}
export async function loadCreatorMarkets(baseUrl: string, chainId: number, account: string, signal?: AbortSignal): Promise<CreatorMarket[]> {
  if (!Number.isInteger(chainId) || !ADDRESS.test(account)) return invalid();
  const normalized = account.toLowerCase();
  let cursor: string | null = null;
  const cursors = new Set<string>();
  const seen = new Set<string>();
  const result: CreatorMarket[] = [];
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await new TickerGardenV1Client(baseUrl, (input, init) => fetch(input, { ...init, signal }))
      .listCreatorMarkets({ address: normalized as `0x${string}`, limit: 100, ...(cursor ? { cursor } : {}) });
    const parsed = validatePage(page, chainId, normalized, seen);
    if (!parsed.complete) throw new Error('Creator Directory Updating');
    result.push(...parsed.items);
    if (parsed.nextCursor === null) return result;
    if (cursors.has(parsed.nextCursor)) return invalid();
    cursors.add(parsed.nextCursor);
    cursor = parsed.nextCursor;
  }
  return invalid();
}
import { TickerGardenV1Client } from './generated/read-api.ts';
