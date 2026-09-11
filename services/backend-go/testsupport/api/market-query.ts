import type { MarketReadModel } from "./models.ts";

export class MarketIdentityUnavailable extends Error {}
const asciiLower=(s:string)=>s.replace(/[A-Z]/g,c=>c.toLowerCase());
export function queryMarkets(items: readonly MarketReadModel[], query: URLSearchParams) {
  const allowed = new Set(["assetUid", "marketId", "memeToken", "launchPhase", "sort", "search", "createdFrom", "createdTo", "limit", "cursor", "revision"]);
  for (const key of query.keys()) {
    if (!allowed.has(key)) throw new Error("unsupported market query parameter");
    if (query.getAll(key).length !== 1) throw new Error("duplicate query parameter");
  }
  const asset = query.get("assetUid")?.toLowerCase() ?? "all";
  if (query.has("assetUid") && !/^0x[0-9a-f]{64}$/.test(asset)) throw new Error("assetUid must be canonical bytes32");
  const market = query.get("marketId")?.toLowerCase() ?? "";
  if (query.has("marketId") && !/^0x[0-9a-f]{64}$/.test(market)) throw new Error("marketId must be canonical bytes32");
  const token = query.get("memeToken")?.toLowerCase() ?? "";
  if (query.has("memeToken") && !/^0x[0-9a-f]{40}$/.test(token)) throw new Error("memeToken must be canonical address");
  const phase = query.get("launchPhase") ?? "";
  if (query.has("launchPhase") && phase !== "0" && phase !== "1") throw new Error("launchPhase must be 0 or 1");
  const order = query.get("sort") ?? "marketId_asc";
  if (!["marketId_asc","marketId_desc","createdAt_asc","createdAt_desc","name_asc","launchPhase_asc","volume24hUsd_desc","marketCapUsd_desc","recentBuy_desc"].includes(order)) throw new Error("unsupported market sort");
  const search=asciiLower(query.get("search") ?? ""), from=query.get("createdFrom") ?? "", to=query.get("createdTo") ?? "";
  if(query.has("search") && (!search || new TextEncoder().encode(search).length>128)) throw new Error("search must contain 1..128 UTF-8 bytes");
  for(const key of ["createdFrom","createdTo"]){if(query.has(key)){const value=query.get(key)!;if(!/^(0|[1-9][0-9]*)$/.test(value) || value.length>19 || BigInt(value)>9223372036854775807n) throw new Error("invalid creation time bound");}}
  if(from && to && BigInt(from)>BigInt(to)) throw new Error("creation time bounds reversed");
  const searchAddress=/^0x[0-9a-f]{40}$/.test(search);if(search.startsWith("0x")&&!searchAddress)throw new Error("search must be a market name or canonical Meme Token address");
  if((search&&!searchAddress) || from || to || order.startsWith("createdAt_") || order==="name_asc"){if(items.some(m=>!m.identity)) throw new MarketIdentityUnavailable("market identity catalog incomplete");}
  let filter = market || token || phase || order !== "marketId_asc" ? JSON.stringify([asset, market, token, phase, order]) : asset;
  if(search || from || to) filter=JSON.stringify([asset,market,token,phase,order,Buffer.from(search,"utf8").toString("base64url"),from,to]);
  const filtered = items.filter(m => (asset === "all" || m.assetUid === asset) && (!market || m.marketId === market) && (!token || m.memeToken === token) && (!phase || m.launchPhase === Number(phase)) && (!search || (searchAddress ? m.memeToken===search : asciiLower(m.identity!.name).includes(search))) && (!from || BigInt(m.identity!.deployedAt)>=BigInt(from)) && (!to || BigInt(m.identity!.deployedAt)<=BigInt(to)));
  const identity = (m:MarketReadModel) => {
    if(order.startsWith("createdAt_")){let time=m.identity!.deployedAt.padStart(19,"0");if(order==="createdAt_desc") time=time.replace(/[0-9]/g,c=>String(9-Number(c)));return `${time}:${m.marketId}`;}
    if(order==="name_asc")return `${Buffer.from(asciiLower(m.identity!.name),"utf8").toString("hex")}/${m.marketId}`;
    if(order==="launchPhase_asc")return `${String(m.launchPhase).padStart(20,"0")}:${m.marketId}`;
    if(order==="recentBuy_desc") {
      const buy=m.lastBuy;
      if(!buy)return `1:${m.marketId}`;
      const key=(value:string)=>{const normalized=value.replace(/^0+(?=\d)/,"");return ("0".repeat(Math.max(0,78-normalized.length))+normalized).replace(/\d/g,c=>String(9-Number(c)));};
      return `0:${key(buy.blockNumber)}:${key(buy.transactionIndex)}:${key(buy.logIndex)}:${m.marketId}`;
    }
    return order === "marketId_asc" ? m.marketId : `0x${m.marketId.slice(2).replace(/[0-9a-f]/g, digit => (15 - parseInt(digit, 16)).toString(16))}`;
  };
  return { items: filtered, filter, identity };
}
