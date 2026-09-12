import assert from "node:assert/strict";
import { test } from "node:test";
import { rewardClaimDialog } from "../src/ui/reward-claim-dialog.ts";

class El {
  textContent = ""; value = ""; returnValue = ""; isConnected = true;
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
    for (const selector of ['input[name="assets"]:checked','.reward-claim-note','.quote-label','.meme-label']) this.nodes.set(selector, new El(selector));
    this.nodes.get('input[name="assets"]:checked')!.value = "3";
  }
}

function setup() {
  const previous = globalThis.document;
  const dialog = new El();
  (globalThis as any).document = { createElement: () => dialog, body: { append: () => {} } };
  return { dialog, restore: () => { globalThis.document = previous; } };
}

test("selecting quote confirms an original quote claim", async () => {
  const {dialog, restore} = setup();
  try {
    const promise = rewardClaimDialog(assets => `${assets} raw`, {quote: "ETH", meme: "Meme"});
    const selected = dialog.nodes.get('input[name="assets"]:checked')!;
    selected.value = "1";
    dialog.dispatch("change", {target: {name: "assets"}});
    dialog.returnValue = "claim"; dialog.dispatch("close");
    assert.equal(await promise, 1);
  } finally { restore(); }
});

test("cancel returns null", async () => {
  const {dialog, restore} = setup();
  try {
    const promise = rewardClaimDialog(() => "raw", {quote: "ETH", meme: "Meme"});
    dialog.returnValue = "cancel"; dialog.dispatch("close");
    assert.equal(await promise, null);
  } finally { restore(); }
});

test("asset label updates with selection", async () => {
  const {dialog, restore} = setup();
  try {
    const promise = rewardClaimDialog(assets => `${assets} raw`, {quote: "ETH", meme: "Meme"});
    const selected = dialog.nodes.get('input[name="assets"]:checked')!; selected.value = "2"; dialog.dispatch("change", {target: {name: "assets"}});
    assert.equal(dialog.nodes.get('.reward-claim-note')!.textContent, '2 raw');
    dialog.returnValue = "cancel"; dialog.dispatch("close"); assert.equal(await promise, null);
  } finally { restore(); }
});
