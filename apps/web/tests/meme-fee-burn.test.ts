import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodeFunctionData, encodeFunctionData, type Address, type Hex } from "viem";
import { deriveCreateMarketParams, buildCreateMarketRequest, MEME_FEE_BURN_MODE, resolveBurnLaunchConfig, type SelectedLaunchConfig } from "../src/v1/features/launch.ts";
import { readCreateDraft, writeCreateDraft, type DraftStorage } from "../src/create/draft.ts";

const h = (n: string): Hex => `0x${n.repeat(64)}` as Hex;
const a = (n: string): Address => `0x${n.repeat(40)}` as Address;
const base = (burnMemeFees?: boolean): SelectedLaunchConfig => ({
  quote: { configId: h("2"), economicsHash: h("2"), quoteAsset: a("1"), tickerGardenBaselineId: h("3"), status: 1 },
  baseline: { baselineId: h("3"), status: 1 }, template: { templateId: h("4"), status: 1 },
  creatorRevenueBeneficiary: a("5"), name: "Test", symbol: "TEST", metadataURI: "ipfs://test", salt: h("6"),
  stakingEnabled: false, ...(burnMemeFees === undefined ? {} : { burnMemeFees }),
});
const storage = (): DraftStorage => { const m = new Map<string, string>(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) }; };

test("derive preserves explicit burn true and false and rejects invalid values", () => {
  assert.equal(deriveCreateMarketParams(base(true)).burnMemeFees, true);
  assert.equal(deriveCreateMarketParams(base(false)).burnMemeFees, false);
  assert.throws(() => deriveCreateMarketParams({ ...base(), burnMemeFees: "yes" as never }), /Invalid token fee burn choice/);
});

test("burn config resolves on current mode and fails closed on legacy mode", async () => {
  assert.equal((await resolveBurnLaunchConfig(base(true), async () => MEME_FEE_BURN_MODE)).burnMemeFees, true);
  assert.equal((await resolveBurnLaunchConfig(base(false), async () => MEME_FEE_BURN_MODE)).burnMemeFees, false);
  await assert.rejects(() => resolveBurnLaunchConfig(base(true), async () => h("f")), /does not support/);
  assert.equal((await resolveBurnLaunchConfig(base(false), async () => h("f"))).burnMemeFees, undefined);
  assert.equal((await resolveBurnLaunchConfig(base(), async () => { throw Error("legacy"); })).burnMemeFees, undefined);
});

test("current ABI request preserves the burn flag", async () => {
  const built = await buildCreateMarketRequest({ factory: a("7"), launchFee: 1n, config: base(true), previewMarketEconomics: async () => h("e") });
  const decoded = decodeFunctionData({ abi: built.request.abi, data: encodeFunctionData({ abi: built.request.abi, functionName: built.request.functionName, args: built.request.args }) });
  assert.equal((decoded.args[0] as { burnMemeFees: boolean }).burnMemeFees, true);
});

test("draft persistence keeps the burn flag", () => {
  const s = storage();
  assert.equal(writeCreateDraft(s, 4663, { burnMemeFees: true, hadImage: false }), true);
  assert.equal(readCreateDraft(s, 4663)?.burnMemeFees, true);
  assert.equal(writeCreateDraft(s, 4663, { burnMemeFees: false, hadImage: false }), true);
  assert.equal(readCreateDraft(s, 4663)?.burnMemeFees, false);
});

test("Create has exactly one burn switch inside Advanced and a separate LP fee choice", () => {
  const source = readFileSync(new URL("../src/pages/create.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  assert.equal((source.match(/name="burnMemeFees"/g) ?? []).length, 1);
  const advanced = source.slice(source.indexOf('<details class="launch-advanced">'), source.indexOf('</details>', source.indexOf('<details class="launch-advanced">')));
  assert.match(advanced, /name="burnMemeFees"/);
  assert.match(advanced, /name="lpFeeEnabled"/);
  assert.match(advanced, /name="lpFeePips"/);
  assert.doesNotMatch(source, /creator and staker fees on claim, holder fees on funding/);
  assert.doesNotMatch(app, /creator and staker fees on claim, holder fees on funding/);
  assert.match(source, /Pool fee after Bloom\. Fixed at launch; 0% when off\./);
});

test('Create fee summaries stay concise at review time', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /ETH allowance/);
  const review = app.slice(app.indexOf('async function submitLaunch'), app.indexOf('async function performLaunch'));
  assert.match(review, /\['LP Fee',`\$\{[^\n]+\}%`\]/);
  assert.doesNotMatch(review, /after Bloom/);
});

test('LP tiers survive preview and ABI encoding, while older deployments reject enabled choice', async () => {
  const {LP_FEE_MODE,resolveLpLaunchConfig}=await import('../src/v1/features/launch.ts');
  for(const lpFeePips of [0,1000,2000,3000]) {
    const config=await resolveLpLaunchConfig({...base(true),lpFeePips},async()=>LP_FEE_MODE);
    const built=await buildCreateMarketRequest({factory:a('7'),launchFee:1n,config,previewMarketEconomics:async draft=>{assert.equal(draft.lpFeePips,lpFeePips);return h('e');}});
    const decoded=decodeFunctionData({abi:built.request.abi,data:encodeFunctionData({abi:built.request.abi,functionName:built.request.functionName,args:built.request.args})});
    assert.equal((decoded.args[0] as {lpFeePips:number}).lpFeePips,lpFeePips);
  }
  for(const fee of [-1,1,500,1001,4000,8388608,NaN])assert.throws(()=>deriveCreateMarketParams({...base(),lpFeePips:fee}),/Invalid LP fee tier/);
  await assert.rejects(()=>resolveLpLaunchConfig({...base(),lpFeePips:1000},async()=>h('f')),/does not support/);
  const old=await resolveLpLaunchConfig({...base(true),lpFeePips:0},async()=>h('f'));
  assert.equal(old.lpFeePips,undefined);assert.equal(old.burnMemeFees,true);
});
