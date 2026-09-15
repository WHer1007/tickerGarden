export type StatsStockRow = {
  id: string;
  label: string;
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

export function mountStatsStockList(container: HTMLElement) {
  const search = document.createElement("input");
  search.type = "search";search.className="stats-stock-search";
  search.placeholder = "Search stocks";
  search.setAttribute("aria-label", "Search stocks");
  const list = document.createElement("div");
  list.className = "stats-stock-list";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "stats-stock-toggle";
  let rows: readonly StatsStockRow[] = [];
  let expanded = false;
  let failureMessage: string | null = null;

  container.replaceChildren(search, list, toggle);

  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = rows.filter(row => !query || `${row.label} ${row.id}`.toLocaleLowerCase().includes(query));
    const ordered = [...filtered].sort((a,b)=>Number(isPositive(b))-Number(isPositive(a))||compareUSD(a,b)||a.label.localeCompare(b.label));
    const visible = expanded || query ? ordered : ordered.filter(isPositive).slice(0, 8);
    list.replaceChildren(...visible.map(row => {
      const item = document.createElement("div");
      item.className = "stats-fee-row";
      const label = document.createElement("span");
      label.className = "stats-asset-label";
      if (row.icon) { const icon = document.createElement("img"); icon.src = row.icon; icon.alt = ""; icon.addEventListener("error", () => icon.remove(), { once: true }); label.append(icon); }
      label.append(document.createTextNode(row.label));
      const value = document.createElement("strong");
      value.textContent = row.value === null ? "-" : new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(Number(row.value));
      item.append(label, value);
      return item;
    }));
    if(!visible.length){const empty=document.createElement("p");empty.className="stats-empty";empty.textContent=failureMessage??(query?"No matching stocks":"No allocated Stock yet");list.append(empty);}
    toggle.hidden = Boolean(query) || (!expanded && visible.length === ordered.length);
    toggle.textContent = expanded ? "Show less" : "Show all";
  }
  search.addEventListener("input", render);
  toggle.addEventListener("click", () => { expanded = !expanded; render(); });
  render();
  return { update(next: readonly StatsStockRow[]) { rows = next; failureMessage = null; render(); }, setUnavailable(message = "Statistics syncing. Try again.") { rows = []; failureMessage = message; render(); }, destroy() { search.removeEventListener("input", render); toggle.replaceWith(); container.replaceChildren(); } };
}
