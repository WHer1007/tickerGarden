import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeAbiParameters, encodeAbiParameters, keccak256, parseAbiParameters, zeroAddress } from "viem";
import { buildPoolTrade, poolAmount, poolTradeRoute, poolProtocolFee, formatPoolProtocolFee, formatPoolFeeSummary, poolTransactionDeadline, poolPermit2Expiration, poolPermit2AllowanceFresh, STAKING_POOL_TRADE_GAS_LIMIT } from "../src/v1/poolTrade.ts";

const quote = "0x0000000000000000000000000000000000000000" as const;
const token = "0x1111111111111111111111111111111111111111" as const;
const tokenQuote = "0x4444444444444444444444444444444444444444" as const;
const hook = "0x2222222222222222222222222222222222222222" as const;
const router = "0x8876789976decbfcbbbe364623c63652db8c0904" as const;
const quoter = "0x3333333333333333333333333333333333333333" as const;
const key = { currency0: quote, currency1: token, fee: 3000, tickSpacing: 60, hooks: hook };
const keyParams = parseAbiParameters("(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)");

function market(overrides: Record<string, unknown> = {}) {
  const boundKey = (overrides.poolKey ?? key) as typeof key;
  return {
    source:{chainId:46630}, launchPhase: 1, poolId: keccak256(encodeAbiParameters(keyParams, [boundKey])), poolKey: boundKey,
    memeToken: token, quoteAsset: quote,
    canonicalRoute: { router, quoter, hook, curveTradingEnabled: false, poolTradingEnabled: true },
    ...overrides,
  } as any;
}

test("binds buy and sell directions to the canonical pool", () => {
  const buy = poolTradeRoute(market(), "buy");
  const sell = poolTradeRoute(market(), "sell");
  assert.deepEqual({ input: buy.input, output: buy.output, zeroForOne: buy.zeroForOne }, { input: quote, output: token, zeroForOne: true });
  assert.deepEqual({ input: sell.input, output: sell.output, zeroForOne: sell.zeroForOne }, { input: token, output: quote, zeroForOne: false });
});

test("normalizes a checksummed hook before matching receipt addresses", () => {
  const checksummedHook = "0xF54CEBD275AcDdf5820aB5Be79313Deab059E044" as const;
  const route = poolTradeRoute(market({
    poolKey: { ...key, hooks: checksummedHook },
    canonicalRoute: { router, quoter, hook: checksummedHook.toLowerCase(), curveTradingEnabled: false, poolTradingEnabled: true },
  }), "sell");
  assert.equal(route.poolKey.hooks, checksummedHook.toLowerCase());
});

test("rejects invalid pool binding and amount limits", () => {
  assert.throws(() => poolTradeRoute(market({ poolId: `0x${"00".repeat(32)}` }), "buy"), /pool ID/);
  assert.throws(() => poolTradeRoute(market({ poolKey: { ...key, hooks: quoter } }), "buy"), /canonical pool binding/);
  assert.throws(() => poolAmount(0n), /outside/);
  assert.throws(() => poolAmount(1n << 128n), /outside/);
  assert.throws(() => buildPoolTrade(market(), "buy", 1n, 1n << 128n, 99n), /outside/);
});

test("pool transaction and Permit2 deadlines follow the chain clock", () => {
  const wallTimestamp = 1_700_000_000n;
  const chainTimestamp = wallTimestamp + 86_401n;
  assert.equal(poolTransactionDeadline(chainTimestamp), chainTimestamp + 3600n);
  const expiration = poolPermit2Expiration(chainTimestamp);
  assert.equal(expiration, Number(chainTimestamp + 600n));
  assert.equal(poolPermit2AllowanceFresh(expiration, chainTimestamp), true);
  assert.equal(poolPermit2AllowanceFresh(Number(chainTimestamp + 119n), chainTimestamp), false);
});

test("pool deadline helpers reject invalid clocks and overflow", () => {
  assert.throws(() => poolTransactionDeadline(-1n), /clock/);
  assert.throws(() => poolTransactionDeadline((1n << 256n) - 1n), /range/);
  assert.throws(() => poolPermit2Expiration((1n << 48n) - 1n), /range/);
  assert.throws(() => poolPermit2AllowanceFresh(-1, 1n), /clock/);
});

test("staking pool trades reserve the FeeVault settlement gas budget", () => {
  assert.equal((buildPoolTrade(market({ stakingEnabled: true }), "buy", 7n, 0n, 99n) as any).gas, STAKING_POOL_TRADE_GAS_LIMIT);
  assert.equal((buildPoolTrade(market({ stakingEnabled: false }), "buy", 7n, 0n, 99n) as any).gas, undefined);
});

test("encodes token UniversalRouter V4_SWAP with minimums and hop price", () => {
  const request = buildPoolTrade(market({ quoteAsset: tokenQuote, poolKey: { ...key, currency0: token, currency1: tokenQuote } }), "buy", 7n, 5n, 99n) as any;
  assert.equal(request.functionName, "execute");
  assert.equal(request.args[0], "0x10");
  assert.equal(request.value, 0n);
  assert.equal(request.args[2], 99n);
  const [commands, inputs] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), request.args[1][0]);
  assert.equal(commands, "0x060c0f");
  const swapInput = inputs[0]; assert.ok(swapInput);
  const [swap] = decodeAbiParameters(parseAbiParameters("((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)"), swapInput);
  assert.equal(swap[1], false); assert.equal(swap[2], 7n); assert.equal(swap[3], 5n); assert.equal(swap[4], 0n);
  const settleInput = inputs[1]; assert.ok(settleInput);
  const [settleAsset, settleAmount] = decodeAbiParameters(parseAbiParameters("address,uint256"), settleInput);
  assert.equal(settleAsset, tokenQuote); assert.equal(settleAmount, 7n);
  const takeInput = inputs[2]; assert.ok(takeInput);
  const [takeAsset, takeMinimum] = decodeAbiParameters(parseAbiParameters("address,uint256"), takeInput);
  assert.equal(takeAsset, token); assert.equal(takeMinimum, 5n);
});

test("adds native refund sweep for native input", () => {
  const m = market({ poolKey: { ...key, currency0: quote, currency1: token }, quoteAsset: quote });
  const request = buildPoolTrade(m, "buy", 7n, 5n, 99n) as any;
  assert.equal(request.args[0], "0x1004"); assert.equal(request.value, 7n); assert.equal(request.args[1].length, 2);
  const [asset, recipient, amount] = decodeAbiParameters(parseAbiParameters("address,address,uint256"), request.args[1][1]);
  assert.equal(asset, zeroAddress); assert.equal(recipient, "0x0000000000000000000000000000000000000001"); assert.equal(amount, 0n);
});

test('zero output minimum is encoded for both trade directions without a hidden price limit',()=>{
 for(const side of ['buy','sell'] as const){
  const request=buildPoolTrade(market(),side,7n,0n,99n) as any;
  const [,inputs]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),request.args[1][0]);
  const [swap]=decodeAbiParameters(parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'),inputs[0]!);
  const [,minimum]=decodeAbiParameters(parseAbiParameters('address,uint256'),inputs[2]!);
  assert.equal(swap[3],0n);assert.equal(swap[4],0n);assert.equal(minimum,0n);
 }
 assert.throws(()=>buildPoolTrade(market(),'buy',7n,-1n,99n),/outside/);
});

test('reads both protocol fee directions without mixing price, tick or LP bits',()=>{
 const state=(protocol:bigint,lp=0n)=>`0x${((1n<<96n)|(0xffffffn<<160n)|(protocol<<184n)|(lp<<208n)).toString(16).padStart(64,'0')}` as `0x${string}`;
 assert.equal(poolProtocolFee(state(1000n|(500n<<12n)),true),1000);
 assert.equal(poolProtocolFee(state(1000n|(500n<<12n)),false),500);
 assert.equal(formatPoolProtocolFee(1000),'0.1%');assert.equal(formatPoolProtocolFee(1),'0.0001%');
 assert.equal(poolProtocolFee(state(0n),true),0);
 assert.throws(()=>poolProtocolFee(state(1001n),true),/Unsupported/);
 assert.throws(()=>poolProtocolFee(state(1001n<<12n),true),/Unsupported/);
 assert.throws(()=>poolProtocolFee(state(0n,3000n),true),/Unsupported/);
 assert.throws(()=>poolProtocolFee('0x00',true),/Invalid/);
});

 test("database service addresses cannot redirect wallet trades",()=>{
 const m=market();m.canonicalRoute.router=token;m.canonicalRoute.quoter=token;
 const r=poolTradeRoute(m,'buy');assert.equal(r.router,router);assert.equal(r.quoter,'0x8dc178efb8111bb0973dd9d722ebeff267c98f94');
 assert.throws(()=>poolTradeRoute(market({source:{chainId:999}}),'buy'),/not configured/);
 });

test('slot0 accepts only the exact configured static LP tier with bounded Core protocol fee',()=>{
 const state=(lp:number,protocol=500)=>`0x${((BigInt(lp)<<208n)|(BigInt(protocol)<<184n)).toString(16).padStart(64,'0')}` as `0x${string}`;
 for(const fee of [0,1000,2000,3000]) {
  assert.equal(poolProtocolFee(state(fee),true,fee),500);
  assert.throws(()=>poolProtocolFee(state((fee+1000)%4000),true,fee),/Unsupported/);
  assert.throws(()=>poolProtocolFee(state(fee,1001),true,fee),/Unsupported/);
 }
 assert.throws(()=>poolProtocolFee(state(500),true,500),/Unsupported/);
});

test('pool fee summary omits zero-value fee categories',()=>{
 assert.equal(formatPoolFeeSummary(3000,0),'Quote includes a 0.3% LP fee.');
 assert.equal(formatPoolFeeSummary(3000,500),'Quote includes a 0.3% LP fee and a 0.05% pool protocol fee.');
 assert.equal(formatPoolFeeSummary(0,500),'Quote includes a 0.05% pool protocol fee.');
 assert.equal(formatPoolFeeSummary(0,0),'No pool fee is added to this quote.');
 assert.throws(()=>formatPoolFeeSummary(500,0),/Invalid LP fee/);
});

test('Pool swap and take actions retain the exact accepted floor after an improved quote',async()=>{
 const {quotedMinimum,approvedQuoteMinimum}=await import('../src/v1/tradeProtection.ts');
 const initial={minimum:quotedMinimum(123456789n)};
 const minimum=approvedQuoteMinimum(initial,{output:123999999n});
 for(const side of ['buy','sell'] as const){
  const request=buildPoolTrade(market(),side,7n,minimum,99n) as any;
  const [,inputs]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),request.args[1][0]);
  const [swap]=decodeAbiParameters(parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'),inputs[0]!);
  const [,takeMinimum]=decodeAbiParameters(parseAbiParameters('address,uint256'),inputs[2]!);
  assert.equal(swap[3],initial.minimum);assert.equal(takeMinimum,initial.minimum);
 }
});
