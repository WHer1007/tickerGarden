import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeAbiParameters,parseAbiParameters,type Address} from 'viem';
import {routes} from '../../packages/chain/src/quote-purchase/routes.ts';
import {USDG,WETH,ZERO,purchaseRoute,poolKey} from '../../packages/chain/src/quote-purchase/quote.ts';
import {assertConversionIntent,conversionRequest,preserveConversionMinimum,type ConversionIntent,type ConversionQuote,PURCHASE_ROUTER} from '../../packages/chain/src/quote-purchase/conversion.ts';

const wallet='0x1111111111111111111111111111111111111111' as Address;
const directV3=Object.entries(routes).find(([,r])=>r.version==='v3'&&r.input===WETH)![0] as Address;
const viaV3=Object.entries(routes).find(([,r])=>r.version==='v3'&&r.input===USDG)![0] as Address;
const directV4=Object.entries(routes).find(([,r])=>r.version==='v4'&&r.input===ZERO)![0] as Address;
const viaV4=Object.entries(routes).find(([,r])=>r.version==='v4'&&r.input===USDG)![0] as Address;
const now=Date.now();
const intent=(buyToken:Address):ConversionIntent=>({chainId:4663,sellToken:ZERO,buyToken,sellAmount:'1000',taker:wallet});
const quote=(i:ConversionIntent,extra:Partial<ConversionQuote>={}):ConversionQuote=>({...i,provider:'configured-pool',buyAmount:'2000',minBuyAmount:'1980',blockNumber:'123',expiresAt:now+60000,priceImpactBps:10,providerFee:null,...extra});

function run(i:ConversionIntent,q=quote(i)) {return conversionRequest(q,i,now);}
function decodeV3(input:`0x${string}`){return decodeAbiParameters(parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]'),input);}
function decodeV4(input:`0x${string}`){const [actions,params]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),input);return {actions,params};}

test('V3 direct USDG exact input wraps fixed ETH, honors 1% minimum and pays the taker',()=>{
 const i=intent(directV3),req=run(i),route=purchaseRoute(i.buyToken);
 assert.equal(route.version,'v3');assert.equal(req.address,PURCHASE_ROUTER);assert.equal(req.value,1000n);assert.equal(req.args[0],'0x0b000c04');
 const wrap=decodeAbiParameters(parseAbiParameters('address,uint256'),req.args[1][0]!);assert.equal(wrap[0],'0x0000000000000000000000000000000000000002');assert.equal(wrap[1],1000n);
 const [recipient,amount,minimum,path,payer,hops]=decodeV3(req.args[1][1]!);
 assert.equal(recipient,wallet);assert.equal(amount,1000n);assert.equal(minimum,1980n);assert.equal(path.toLowerCase(),`0x${WETH.slice(2)}${route.fee.toString(16).padStart(6,'0')}${route.output.slice(2)}`.toLowerCase());assert.equal(payer,false);assert.deepEqual(hops,[0n]);
});

test('V3 via USDG buys the configured token in one exact-input path',()=>{
 const i=intent(viaV3),req=run(i),route=purchaseRoute(i.buyToken);
 assert.equal(route.version,'v3');assert.equal(req.value,1000n);assert.equal(req.args[0],'0x0b00040c04');
 const [recipient,amount,minimum,path,payer,hops]=decodeV3(req.args[1][1]!);
 assert.equal(recipient,wallet);assert.equal(amount,1000n);assert.equal(minimum,1980n);assert.equal(path.toLowerCase(),`0x${WETH.slice(2)}000064${USDG.slice(2)}${route.fee.toString(16).padStart(6,'0')}${i.buyToken.slice(2)}`.toLowerCase());assert.equal(payer,false);assert.deepEqual(hops,[0n,0n]);
});

test('V4 direct ETH route executes exact input with fixed value, recipient and minimum',()=>{
 const i=intent(directV4),req=run(i),route=purchaseRoute(i.buyToken);assert.equal(route.version,'v4');assert.equal(req.value,1000n);assert.equal(req.args[0],'0x1004');
 const {actions,params}=decodeV4(req.args[1][0]!);assert.equal(actions,'0x0b060e');
 const [currency,settled,close]=decodeAbiParameters(parseAbiParameters('address,uint256,bool'),params[0]!);assert.equal(currency,ZERO);assert.equal(settled,1000n);assert.equal(close,false);
 const [swap]=decodeAbiParameters(parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'),params[1]!);assert.deepEqual(swap[0].map((v,i)=>typeof v==='string'&&i!==2&&i!==3?v.toLowerCase():v),Object.values(poolKey(route)).map((v,i)=>typeof v==='string'&&i!==2&&i!==3?v.toLowerCase():v));assert.equal(swap[2],0n);assert.equal(swap[3],1980n);
 const [token,recipient,min]=decodeAbiParameters(parseAbiParameters('address,address,uint256'),params[2]!);assert.equal(token.toLowerCase(),i.buyToken.toLowerCase());assert.equal(recipient,wallet);assert.equal(min,0n);
});

test('V4 via USDG bridges the exact ETH amount, consumes bridge credit and returns residue',()=>{
 const i=intent(viaV4),req=run(i),route=purchaseRoute(i.buyToken);assert.equal(route.version,'v4');assert.equal(req.value,1000n);assert.equal(req.args[0],'0x0b0010040c04');
 const [recipient,amount,minimum,path,payer,hops]=decodeV3(req.args[1][1]!);assert.equal(recipient,'0x0000000000000000000000000000000000000002');assert.equal(amount,1000n);assert.equal(minimum,0n);assert.equal(path.toLowerCase(),`0x${WETH.slice(2)}000064${USDG.slice(2)}`.toLowerCase());assert.equal(payer,false);assert.deepEqual(hops,[0n]);
 const {actions,params}=decodeV4(req.args[1][2]!);assert.equal(actions,'0x0b060e');
 const [currency,settled,close]=decodeAbiParameters(parseAbiParameters('address,uint256,bool'),params[0]!);assert.equal(currency.toLowerCase(),USDG.toLowerCase());assert.equal(settled,1n<<255n);assert.equal(close,false);
 const [swap]=decodeAbiParameters(parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'),params[1]!);assert.deepEqual(swap[0].map((v,i)=>typeof v==='string'&&i!==2&&i!==3?v.toLowerCase():v),Object.values(poolKey(route)).map((v,i)=>typeof v==='string'&&i!==2&&i!==3?v.toLowerCase():v));assert.equal(swap[2],0n);assert.equal(swap[3],1980n);
 const [token,recipientOut,min]=decodeAbiParameters(parseAbiParameters('address,address,uint256'),params[2]!);assert.equal(token.toLowerCase(),i.buyToken.toLowerCase());assert.equal(recipientOut,wallet);assert.equal(min,0n);
 assert.equal(decodeAbiParameters(parseAbiParameters('address,address,uint256'),req.args[1][3]!)[1],wallet);
 assert.equal(decodeAbiParameters(parseAbiParameters('address,uint256'),req.args[1][4]!)[0],wallet);
});

test('conversion quote rejects tampered intent, expiry, numeric values and unsupported assets',()=>{
 const i=intent(directV3),valid=quote(i);
 assert.throws(()=>run(i,{...valid,buyToken:directV4}),/does not match/);
 assert.throws(()=>run(i,{...valid,taker:'0x2222222222222222222222222222222222222222'}),/does not match/);
 assert.throws(()=>run(i,{...valid,sellAmount:'1001'}),/does not match/);
 assert.throws(()=>run(i,{...valid,expiresAt:now}),/does not match/);
 assert.throws(()=>run(i,{...valid,expiresAt:now+90001}),/does not match/);
 for(const [field,value] of [['buyAmount','0'],['buyAmount','01'],['minBuyAmount','2001'],['minBuyAmount','1979'],['buyAmount','not-a-number']] as const)
  assert.throws(()=>run(i,{...valid,[field]:value}),/does not match/);
 assert.throws(()=>run(i,{...valid,blockNumber:'not-a-number'}),/does not match/);
 assert.throws(()=>assertConversionIntent({...i,buyToken:'0x0000000000000000000000000000000000000003'}),/Unsupported paired asset/);
 assert.throws(()=>assertConversionIntent({...i,sellToken:USDG}),/Invalid conversion request/);
 assert.doesNotThrow(()=>assertConversionIntent({...i,buyToken:USDG}));
});

test('refresh preserves the previously confirmed output floor',()=>{
 const i=intent(directV3),reviewed=quote(i,{buyAmount:'2000',minBuyAmount:'1980'});
 const refreshed=quote(i,{buyAmount:'1990',minBuyAmount:'1970'});
 const result=preserveConversionMinimum(refreshed,reviewed);
 assert.equal(result.minBuyAmount,'1980');assert.equal(result.buyAmount,'1990');
 assert.throws(()=>preserveConversionMinimum(quote(i,{buyAmount:'1979',minBuyAmount:'1970'}),reviewed),/beyond the confirmed conversion minimum/);
});
