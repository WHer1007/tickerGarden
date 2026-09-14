import assert from "node:assert/strict";
import { test } from "node:test";
import { rewardClaimDialog } from "../src/ui/reward-claim-dialog.ts";

class El {
  disabled = false; checked = false; hidden = false;
  attributes = new Map<string,string>();
  setAttribute(name:string,value:string) { this.attributes.set(name,value); }
  label: El | undefined;
  closest(_selector:string) { return this.label ??= new El(); }
  querySelectorAll(_selector:string) { return [...this.nodes.values()].filter(el=>el.selector === "radio"); }
  textContent = ""; value = ""; returnValue = ""; isConnected = true;
  listeners = new Map<string, (event?: unknown) => void>();
  selector: string;
  constructor(selector = "") { this.selector = selector; }
  addEventListener(name: string, fn: (event?: unknown) => void) { this.listeners.set(name, fn); }
  remove() { this.isConnected = false; }
  showModal() {}
  dispatch(name: string, event?: unknown) { this.listeners.get(name)?.(event); }
  querySelector<T extends El>(selector: string): T { return (selector==='input[name="assets"]:checked' ? [...this.nodes.values()].find(el=>el.selector==="radio"&&el.checked)! : this.nodes.get(selector) ?? new El(selector)) as T; }
  nodes = new Map<string, El>();
  set innerHTML(_value: string) {
    for (const selector of ['input[name="assets"]:checked','.quote-label','.meme-label']) this.nodes.set(selector, new El(selector));
    const selected=this.nodes.get('input[name="assets"]:checked')!;selected.value="3";selected.selector="radio";selected.checked=true;
    for(const value of ['1','2']) { const radio=new El('radio');radio.value=value;this.nodes.set(value,radio); }
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
    const promise = rewardClaimDialog({quote: "ETH", meme: "Meme"});
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
    const promise = rewardClaimDialog({quote: "ETH", meme: "Meme"});
    dialog.returnValue = "cancel"; dialog.dispatch("close");
    assert.equal(await promise, null);
  } finally { restore(); }
});

test("the dialog does not render an internal claim estimate", async () => {
  const {dialog, restore} = setup();
  try {
    const promise = rewardClaimDialog({quote: "ETH", meme: "Meme"});
    assert.equal(dialog.nodes.has('.reward-claim-note'), false);
    dialog.returnValue = "cancel"; dialog.dispatch("close"); assert.equal(await promise, null);
  } finally { restore(); }
});

test('only the still-unclaimed asset is selectable and selected by default', async () => {
  const {dialog,restore}=setup();
  try {
    const promise=rewardClaimDialog({quote:'ETH',meme:'Meme'},2);
    assert.equal(dialog.nodes.get('1')!.disabled,true);
    assert.equal(dialog.nodes.get('input[name="assets"]:checked')!.disabled,true);
    assert.equal(dialog.nodes.get('2')!.checked,true);
    dialog.returnValue='claim';dialog.dispatch('close');assert.equal(await promise,2);
  } finally {restore();}
});
