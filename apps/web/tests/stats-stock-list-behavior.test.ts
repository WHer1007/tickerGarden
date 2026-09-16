import assert from 'node:assert/strict';
import { test } from 'node:test';

class FakeElement {
  tagName = 'div'; className = ''; textContent = ''; title = ''; value = ''; type = ''; placeholder = '';
  checked = false; children: FakeElement[] = []; parent: FakeElement | null = null;
  listeners = new Map<string, () => void>();
  constructor(tag = 'div') { this.tagName = tag; }
  append(...nodes: FakeElement[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: FakeElement[]) { this.children = []; this.append(...nodes); }
  addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
  dispatch(name: string) { this.listeners.get(name)?.(); }
  setAttribute() {}
  querySelectorAll(selector: string): FakeElement[] {
    const matches = (node: FakeElement) => selector === 'input' ? node.tagName === 'input' : selector === 'strong' ? node.tagName === 'strong' : selector === 'small' ? node.tagName === 'small' : selector === '.stats-fee-row' ? node.className === 'stats-fee-row' : false;
    return this.children.flatMap(child => [ ...(matches(child) ? [child] : []), ...child.querySelectorAll(selector) ]);
  }
}

function text(node: FakeElement): string { return node.textContent || node.children.map(text).join(''); }

async function mount(full: boolean) {
  const oldDocument = globalThis.document;
  (globalThis as any).document = { createElement: (tag: string) => new FakeElement(tag), createTextNode: (value: string) => Object.assign(new FakeElement('text'), { textContent: value }) };
  const { mountStatsStockList } = await import(`../src/ui/stats-stock-list.ts?behavior=${Date.now()}-${Math.random()}`);
  const container = new FakeElement('section');
  const list = mountStatsStockList(container, { full });
  const restore = () => { globalThis.document = oldDocument; };
  return { container, list, restore };
}

test('full Stock stats searches symbol and name and restores after clearing', async () => {
  const { container, list, restore } = await mount(true);
  try {
    list.update([
      { id: 'a', label: 'ACME', symbol: 'ACM', name: 'Acme Corp', value: '12.50', amount: 1n, decimals: 0 },
      { id: 'b', label: 'Beta Holdings', symbol: 'BETA', name: 'Beta Holdings', value: '2.00', amount: 1n, decimals: 0 },
    ] as any);
    const search = container.querySelectorAll('input').find(input => input.type === 'search')!;
    search.value = 'acm'; search.dispatch('input');
    assert.equal(container.querySelectorAll('.stats-fee-row').length, 1);
    search.value = ''; search.dispatch('input');
    assert.equal(container.querySelectorAll('.stats-fee-row').length, 2);
  } finally { restore(); }
});

test('full Stock stats hides known zero allocations but retains unknown amounts', async () => {
  const { container, list, restore } = await mount(true);
  try {
    list.update([
      { id: 'zero', label: 'Zero', value: '0', amount: 0n, decimals: 0 },
      { id: 'unknown', label: 'Unknown', value: null, amount: null, decimals: 18 },
    ]);
    const toggle = container.querySelectorAll('input').find(input => input.type === 'checkbox')!;
    toggle.checked = true; toggle.dispatch('change');
    assert.equal(container.querySelectorAll('.stats-fee-row').length, 1);
    assert.match(text(container), /Unknown/);
  } finally { restore(); }
});

test('Stock quantity display preserves large integer precision', async () => {
  const { container, list, restore } = await mount(true);
  try {
    list.update([{ id: 'large', label: 'Large', value: '1.25', amount: 123456789012345678901n, decimals: 18 }]);
    assert.match(text(container), /123\.456789012345678901/);
  } finally { restore(); }
});

test('home Stats list has no search control or quantity details', async () => {
  const { container, list, restore } = await mount(false);
  try {
    list.update([{ id: 'home', label: 'Home', value: '1.00', amount: 1n, decimals: 0 }]);
    assert.equal(container.querySelectorAll('input').length, 0);
    assert.doesNotMatch(text(container), /Allocated:/);
  } finally { restore(); }
});
