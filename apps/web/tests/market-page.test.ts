import assert from 'node:assert/strict';
import test from 'node:test';
import {marketPage} from '../api/market-page.ts';
import {pageMetadata} from '../src/routing/metadata.ts';
const id='0x'+'a'.repeat(64),shell='<html><head><title>Home</title></head><body><div data-route-outlet></div><script src="/app.js"></script></body></html>';
const env={VITE_V1_READ_API_URL:'https://read.example',VITE_V1_CHAIN_ID:'4663'};
test('market sharing preserves only the market identity in its canonical URL',()=>{
 assert.equal(pageMetadata('trade',`/trade?marketId=${id}&other=secret#x`).canonical,`https://tickergarden.com/trade?marketId=${id}`);
});
test('crawler response contains escaped market metadata and the executable shell',async()=>{
 const fetcher=(async()=>Response.json({sync:{chainId:4663},market:{marketId:id,identity:{name:'<script>"&',symbol:'ABC'}}})) as typeof fetch;
 const response=await marketPage(new Request(`https://tickergarden.com/trade?marketId=${id}`),shell,env,fetcher);
 const html=await response.text();assert.match(html,/&lt;script&gt;&quot;&amp;/);assert.match(html,/marketId=0xaaaa/);assert.match(html,/src="\/app.js"/);assert.equal((html.match(/<title>/g)||[]).length,1);assert.match(response.headers.get('cache-control')!,/s-maxage=60/);
});
test('wrong chain, failed directory and invalid IDs fall back to the trading shell',async()=>{
 for(const fetcher of [(async()=>{throw Error('offline');}),(async()=>Response.json({sync:{chainId:46630},market:{marketId:id,identity:{name:'Wrong',symbol:'WRONG'}}}))]){
  const response=await marketPage(new Request(`https://tickergarden.com/trade?marketId=${id}`),shell,env,fetcher as typeof fetch);
  assert.match(await response.text(),/Trade a market/);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 await marketPage(new Request('https://tickergarden.com/trade?marketId=bad'),shell,env,async()=>{assert.fail('Invalid ID must not request data');});
});
