import assert from "node:assert/strict";
import { test } from "node:test";
import { rewardClaimDialog } from "../src/ui/reward-claim-dialog.ts";

class El {
  textContent = ""; hidden = false; disabled = false; checked = false; value = ""; returnValue = ""; isConnected = true;
  listeners = new Map<string, (event?: unknown) => void>();
  selector: string;
  constructor(selector = "") { this.selector = selector; }
  addEventListener(name: string, fn: (event?: unknown) => void) { this.listeners.set(name, fn); }
  remove() { this.isConnected = false; }
  showModal() {}
  dispatch(name: string, event?: unknown) { this.listeners.get(name)?.(event); }
  querySelector<T extends El>(selector: string): T { return (this.nodes.get(selector) ?? new El(selector)) as T; }
  nodes = new Map<string, El>();
  set innerHTML(_value: string) {
    for (const selector of ['input[name="assets"]:checked','input[value="raw"]','input[value="convert"]','input[name="fallback"]','.reward-claim-fallback','.reward-claim-estimate','.quote-label','.meme-label']) this.nodes.set(selector, new El(selector));
    this.nodes.get('input[name="assets"]:checked')!.value = "3";
    this.nodes.get('input[value="convert"]')!.checked = true;
  }
}

function setup() {
  const previous = globalThis.document;
  const dialog = new El();
  (globalThis as any).document = { createElement: () => dialog, body: { append: () => {} } };
  return { dialog, restore: () => { globalThis.document = previous; } };
}

test("quote-only forces original quote claim and disables fallback", async () => {
  const {dialog, restore} = setup();
  try {
    const promise = rewardClaimDialog(async () => "estimate", assets => `${assets} raw`);
    const selected = dialog.nodes.get('input[name="assets"]:checked')!;
    selected.value = "1";
    dialog.dispatch("change", {target: {name: "assets"}});
    assert.equal(dialog.nodes.get('input[value="raw"]')!.checked, true);
    assert.equal(dialog.nodes.get('input[value="convert"]')!.disabled, true);
    assert.equal(dialog.nodes.get('input[name="fallback"]')!.disabled, true);
    dialog.returnValue = "claim"; dialog.dispatch("close");
    assert.deepEqual(await promise, {assets: 1, convert: false, rawFallback: false});
  } finally { restore(); }
});

test("raw claim completes while conversion estimate is pending", async () => {
  const {dialog, restore} = setup();
  try {
    const promise = rewardClaimDialog(() => new Promise(() => {}), assets => `${assets} raw`);
    dialog.nodes.get('input[value="raw"]')!.checked = true; dialog.dispatch("change", {target: {name: "mode"}});
    dialog.returnValue = "claim"; dialog.dispatch("close");
    assert.deepEqual(await promise, {assets: 3, convert: false, rawFallback: false});
  } finally { restore(); }
});

test("late estimates are ignored after asset changes and close", async () => {
  const {dialog, restore} = setup();
  try {
    const pending: Array<(value: string) => void> = [];
    const promise = rewardClaimDialog(assets => new Promise(resolve => pending.push(value => resolve(`${assets}:${value}`))), assets => `${assets} raw`);
    pending[0]!('old');
    const selected = dialog.nodes.get('input[name="assets"]:checked')!; selected.value = "2"; dialog.dispatch("change", {target: {name: "assets"}});
    pending[1]!('new'); await Promise.resolve();
    assert.equal(dialog.nodes.get('.reward-claim-estimate')!.textContent, '2:new');
    selected.value = "3"; dialog.dispatch("change", {target: {name: "assets"}});
    const beforeClose = dialog.nodes.get('.reward-claim-estimate')!.textContent;
    dialog.returnValue = "cancel"; dialog.dispatch("close");
    pending[2]!('closed'); await Promise.resolve();
    assert.equal(dialog.nodes.get('.reward-claim-estimate')!.textContent, beforeClose);
    assert.equal(await promise, null);
  } finally { restore(); }
});
