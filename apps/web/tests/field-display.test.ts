import assert from 'node:assert/strict';
import test from 'node:test';
import {marketHref,chainHref,scopeChainLinks} from '../src/routing/chain-links.ts';
import {pageMetadata} from '../src/routing/metadata.ts';
import {marketPage} from '../api/market-page.ts';
import {renderMetadata} from '../src/routing/metadata.ts';
import {forChain as docs} from '../src/pages/docs.ts';
import {forChain as home} from '../src/pages/home.ts';
import {holderClaimsNotice} from '../src/chains/asset-availability.ts';
import {bscStockCount} from '../src/chains/public-content.ts';
import {tradeTimestamp} from '../src/v1/displayFields.ts';
const id=`0x${'a'.repeat(64)}`;

test('copyable market links and canonical URLs retain chain, but drop arbitrary query data',()=>{
 for(const [chainId,chain] of [[56,'bsc'],[4663,'rh'],[46630,'rh']] as const){
  const href=marketHref(id,chainId);assert.equal(new URL(href,'https://test').searchParams.get('chain'),chain);
  const canonical=pageMetadata('trade',`${href}&tracking=secret#tab`).canonical;
  assert.equal(canonical,`https://tickergarden.com/trade?marketId=${id}&chain=${chain}`);
 }
 assert.equal(pageMetadata('trade',`/trade?marketId=${id}`).canonical,`https://tickergarden.com/trade?marketId=${id}`);
 assert.equal(chainHref('/claim#treasury',56),'/claim?chain=bsc#treasury');
 assert.equal(chainHref('/explore?chain=rh',56),'/explore?chain=rh');
 assert.equal(chainHref('//external.example/x',56),'//external.example/x');
 assert.equal(chainHref('#docs-network',56),'#docs-network');
 let href='/create';scopeChainLinks({querySelectorAll:()=>[{getAttribute:()=>href,setAttribute:(_:string,value:string)=>{href=value;}}]} as unknown as ParentNode,56);assert.equal(href,'/create?chain=bsc');
});

test('server BSC metadata uses only BSC configuration and enforces returned chain identity',async()=>{
 const shell=`<head>${renderMetadata('trade')}</head><body>Trading shell</body>`;
 const env={VITE_V1_CHAIN_ID:'4663',VITE_V1_READ_API_URL:'https://rh.example',VITE_BSC_READ_API_URL:'https://gateway.example'};
 const request=new Request(`https://tickergarden.com${marketHref(id,56)}`);
 let calls=0;
 const response=await marketPage(request,shell,env,async input=>{calls++;const url=new URL(String(input));assert.equal(url.origin,'https://gateway.example');assert.equal(url.searchParams.get('chainId'),'56');return Response.json({sync:{chainId:56},market:{marketId:id,identity:{name:'Bull',symbol:'TBULL'}}});});
 const html=await response.text();assert.match(html,/Bull \(TBULL\)/);assert.match(html,/BNB Smart Chain/);assert.doesNotMatch(html,/market on Robinhood Chain/);assert.match(html,/&amp;chain=bsc/);assert.equal(calls,1);
 const missing=await marketPage(request,shell,{VITE_V1_CHAIN_ID:'4663',VITE_V1_READ_API_URL:'https://rh.example'},async()=>{assert.fail('Must not query RH as fallback');});assert.equal(missing.headers.get('cache-control'),'no-store');
 const wrong=await marketPage(request,shell,env,async()=>Response.json({sync:{chainId:4663},market:{marketId:id,identity:{name:'Wrong',symbol:'BAD'}}}));assert.doesNotMatch(await wrong.text(),/Wrong \(BAD\)/);
});

test('BSC copy uses BNB, its own contracts, fixed targets and closed Holder status; RH stays distinct',()=>{
 assert.match(home(56).html,new RegExp(`${bscStockCount} Stock tokens`));assert.match(home(56).html,/bStocks on BNB Chain/);
 assert.doesNotMatch(home(56).html,/Official Robinhood assets/);assert.match(home(4663).html,/194 Stock tokens/);
 const bsc=docs(56).html,rh=docs(4663).html;
 for(const expected of ['BNB Smart Chain','78 registered bStocks','USDT and USDC targets are each 7,000','do not change with live prices','https://bscscan.com/address/','0x186d0c4b6f9f33a30545c0acff8e0cd90cc20578','Holder claims are not open'])assert.ok(bsc.includes(expected),expected);
 assert.doesNotMatch(bsc,/robinhoodchain\.blockscout|3 ETH|7,000 USDG|Keep enough ETH/);
 assert.match(rh,/3 ETH/);assert.match(rh,/robinhoodchain\.blockscout/);assert.doesNotMatch(rh,/bscscan\.com/);
 assert.match(pageMetadata('create','/create?chain=bsc').title,/BNB Smart Chain/);
 assert.match(holderClaimsNotice(56),/not open/);assert.equal(holderClaimsNotice(4663),'');
});

test('trade dates disambiguate older days and years, with full UTC time available',()=>{
 const now=new Date(2026,10,14,14,20,0),today=new Date(2026,10,14,10,0,0),old=new Date(2026,8,19,19,35,33),prior=new Date(2025,8,19,19,35,33);
 assert.match(tradeTimestamp(today.getTime()/1000,now).label,/^10:00:00$/);
 assert.match(tradeTimestamp(old.getTime()/1000,now).label,/19 Sept.*19:35:33/);
 assert.match(tradeTimestamp(prior.getTime()/1000,now).label,/2025/);
 assert.equal(tradeTimestamp(old.getTime()/1000,now).title,old.toISOString());
});
