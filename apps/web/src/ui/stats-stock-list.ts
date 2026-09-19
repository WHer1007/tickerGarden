export type StatsStockRow = {
  id: string;
  label: string;
  name?: string;
  icon?: string;
  value: string | null;
  amount: bigint | null;
  decimals: number;
};

type Decimal = { digits: bigint; scale: number };

function decimal(value: string): Decimal | null {
  const text = value.trim().replace(/^\+/, "");
  if (!/^\d*(?:\.\d*)?$/.test(text) || text === ".") return null;
  const [whole = "", fraction = ""] = text.split(".");
  const digits = `${whole || "0"}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  return { digits: BigInt(digits), scale: fraction.length };
}

function compareUSD(a: StatsStockRow, b: StatsStockRow): number {
  if (a.value === null) return b.value === null ? 0 : 1;
  if (b.value === null) return -1;
  const left = decimal(a.value);
  const right = decimal(b.value);
  if (!left || !right) return a.value.localeCompare(b.value);
  const scale = Math.max(left.scale, right.scale);
  const av = left.digits * 10n ** BigInt(scale - left.scale);
  const bv = right.digits * 10n ** BigInt(scale - right.scale);
  return av === bv ? 0 : av > bv ? -1 : 1;
}

function isPositive(row: StatsStockRow): boolean {
  // A missing token amount is an unknown balance and remains visible by default.
  return row.amount === null || row.amount > 0n;
}

function formatAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const text = amount.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, -decimals) || "0";
  const fraction = text.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function mountStatsStockList(container: HTMLElement, options: { full?: boolean } = {}) {
  const list = document.createElement("div");
  list.className = "stats-stock-list";
  let hideZero = false;
  let searchTerm = "";
  if (options.full) {
    const controls = document.createElement("div");
    controls.className = "stats-stock-controls";
    const label = document.createElement("label");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.addEventListener("change", () => { hideZero = toggle.checked; render(); });
    label.append(toggle, document.createTextNode(" Hide zero allocations"));
    const searchLabel = document.createElement("label");
    searchLabel.className = "stats-stock-search";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search Stock name or symbol";
    search.setAttribute("aria-label", "Search Stock name or symbol");
    search.addEventListener("input", () => { searchTerm = search.value.trim().toLowerCase(); render(); });
    searchLabel.append(search);
    controls.append(searchLabel, label);
    container.replaceChildren(controls, list);
  } else container.replaceChildren(list);
  let rows: readonly StatsStockRow[] = [];
  let failureMessage: string | null = null;
  const rendered = new Map<string, { item: HTMLDivElement; label: HTMLSpanElement; labelText: Text; icon: HTMLImageElement | null; value: HTMLElement; exact: HTMLDetailsElement | null; amount: HTMLElement | null; quantity: HTMLElement }>();

  function createRow(row: StatsStockRow) {
    const item = document.createElement("div"); item.className = "stats-fee-row";
    const label = document.createElement("span"); label.className = "stats-asset-label";
    let icon: HTMLImageElement | null = null;
    if (row.icon) { icon = document.createElement("img"); icon.src = row.icon; icon.alt = ""; icon.addEventListener("error", () => icon?.remove(), { once: true }); label.append(icon); }
    const labelText = document.createTextNode(row.label); label.append(labelText);
    const value = document.createElement("strong");
    const quantity = document.createElement("small"); quantity.className = "stats-stock-quantity";
    let exact: HTMLDetailsElement | null = null, amount: HTMLElement | null = null;
    if (options.full) {
      exact = document.createElement("details"); exact.className = "stats-stock-exact";
      const summary = document.createElement("summary"); summary.append(value);
      amount = document.createElement("small"); exact.append(summary, amount); item.append(label, exact, quantity);
    } else item.append(label, value);
    const parts = { item, label, labelText, icon, value, exact, amount, quantity };
    rendered.set(row.id, parts);
    return parts;
  }

  function updateRow(row: StatsStockRow) {
    const parts = rendered.get(row.id)!;
    parts.labelText.textContent = row.label;
    if (row.icon !== (parts.icon?.getAttribute("src") ?? undefined)) {
      parts.icon?.remove(); parts.icon = null;
      if (row.icon) { const icon = document.createElement("img"); icon.src = row.icon; icon.alt = ""; icon.addEventListener("error", () => icon.remove(), { once: true }); parts.label.insertBefore(icon, parts.labelText); parts.icon = icon; }
    }
    parts.value.textContent = row.value === null ? "-" : new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(Number(row.value));
    if (row.value !== null) parts.value.title = `Exact USD value: $${row.value}`; else parts.value.removeAttribute("title");
    if (parts.amount) parts.amount.textContent = row.value === null ? "-" : `$${row.value}`;
    parts.quantity.textContent = row.amount === null ? "-" : `Allocated: ${formatAmount(row.amount, row.decimals)}`;
    return parts.item;
  }

  function render() {
    const ordered = [...rows].sort((a,b)=>Number(isPositive(b))-Number(isPositive(a))||compareUSD(a,b)||a.label.localeCompare(b.label));
    const searched = searchTerm ? ordered.filter(row => `${row.label} ${row.name??''}`.toLowerCase().includes(searchTerm)) : ordered;
    const visible = options.full ? (hideZero ? searched.filter(row=>row.amount!==0n) : searched) : ordered.filter(isPositive).slice(0, 8);
    const visibleIds = new Set(visible.map(row => row.id));
    for (const id of rendered.keys()) if (!visibleIds.has(id)) rendered.delete(id);
    const nodes = visible.map(row => { if (!rendered.has(row.id)) createRow(row); return updateRow(row); });
    // Reuse details nodes; explicitly restore focus if ranking changes move rows.
    const focused=document.activeElement as HTMLElement|null;
    const restoreFocus=!!focused&&list.contains(focused);
    const empty = list.querySelector(".stats-empty"); empty?.remove();
    if (nodes.length !== list.children.length || nodes.some((node, index) => list.children[index] !== node)) list.replaceChildren(...nodes);
    if(restoreFocus&&focused&&list.contains(focused))focused.focus({preventScroll:true});
    if(!visible.length){const empty=document.createElement("p");empty.className="stats-empty";empty.textContent=failureMessage??(searchTerm?"No Stock matches found":"No allocated Stock yet");list.append(empty);}
  }
  render();
  return { update(next: readonly StatsStockRow[]) { rows = next; failureMessage = null; render(); }, setUnavailable() { rows = []; failureMessage = "-"; render(); }, destroy() { container.replaceChildren(); } };
}
