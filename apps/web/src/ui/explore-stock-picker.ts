export type ExploreStockOption = {
  value: string;
  symbol: string;
  name: string;
  logo?: string;
};

export function setupExploreStockPicker(
  select: HTMLSelectElement,
  initialOptions: readonly ExploreStockOption[],
): { update(options: readonly ExploreStockOption[]): void; destroy(): void } {
  const controller = new AbortController();
  const { signal } = controller;
  const root = document.createElement("div");
  root.className = "explore-stock-picker";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "explore-stock-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const current = document.createElement("span");
  current.className = "explore-stock-current";
  trigger.append(current);
  const caret=document.createElement("i");caret.className="ph ph-caret-down";caret.setAttribute("aria-hidden","true");trigger.append(caret);

  const menu = document.createElement("div");
  menu.className = "explore-stock-menu";
  menu.hidden = true;

  const search = document.createElement("input");
  search.type = "search";
  search.className = "explore-stock-search-input";
  search.placeholder = "Search stocks";
  search.setAttribute("aria-label", "Search stocks");
  menu.append(search);

  const optionsList = document.createElement("div");
  optionsList.className = "explore-stock-options";
  optionsList.setAttribute("role", "listbox");
  menu.append(optionsList);
  root.append(trigger, menu);
  select.insertAdjacentElement("afterend", root);

  let options: readonly ExploreStockOption[] = [];
  let focusedIndex = -1;

  function selectedOption(): ExploreStockOption | undefined {
    return options.find((option) => option.value === select.value);
  }

  function renderCurrent(): void {
    current.replaceChildren();
    const selected = selectedOption();
    if (!selected) {
      current.textContent = "All Stocks";
      trigger.setAttribute("aria-label", "Stock filter: all");
      return;
    }
    if (selected.logo) {
      const image = document.createElement("img");
      image.src = selected.logo;
      image.alt = "";
      current.append(image);
    }
    current.append(document.createTextNode(selected.symbol));
    trigger.setAttribute("aria-label", `Stock filter: ${selected.symbol}`);
  }

  function renderOptions(): void {
    optionsList.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const visible = options.filter((option) =>
      !query || `${option.symbol} ${option.name}`.toLowerCase().includes(query),
    );
    const all = document.createElement("button");
    all.type = "button";
    all.className = "explore-stock-option";
    all.dataset.value = "";
    all.setAttribute("role", "option");
    all.textContent = "All Stocks";
    all.setAttribute("aria-selected", String(select.value === ""));
    optionsList.append(all);
    for (const option of visible) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "explore-stock-option";
      item.dataset.value = option.value;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(select.value === option.value));
      if (option.logo) {
        const image = document.createElement("img");
        image.src = option.logo;
        image.alt = "";
        item.append(image);
      }
      const label = document.createElement("span");
      const symbol=document.createElement("strong");symbol.textContent=option.symbol;const name=document.createElement("small");name.textContent=option.name;label.append(symbol,name);
      item.append(label);
      optionsList.append(item);
    }
  }

  function setOpen(open: boolean): void {
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      focusedIndex = -1;
      search.focus();
      renderOptions();
    } else if (menu.contains(document.activeElement)) {
      trigger.focus();
    }
  }

  function choose(value: string): void {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    renderCurrent();
    renderOptions();
    setOpen(false);trigger.focus();
  }

  trigger.addEventListener("click", () => setOpen(menu.hidden), { signal });
  search.addEventListener("input", renderOptions, { signal });
  optionsList.addEventListener("click", (event) => {
    const item = (event.target as Element).closest<HTMLButtonElement>(".explore-stock-option");
    if (item) choose(item.dataset.value ?? "");
  }, { signal });
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = [...optionsList.querySelectorAll<HTMLButtonElement>(".explore-stock-option")];
      if (items.length) {
        focusedIndex = event.key === "ArrowDown"
          ? (focusedIndex + 1) % items.length
          : (focusedIndex - 1 + items.length) % items.length;
        const item = items[focusedIndex];
        if (item) item.focus();
      }
    } else if (event.key === "Escape") setOpen(false);
  }, { signal });
  optionsList.addEventListener("keydown", (event) => {
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const items=[...optionsList.querySelectorAll<HTMLButtonElement>('.explore-stock-option')];const index=items.indexOf(document.activeElement as HTMLButtonElement);items[(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}
    if (event.key === "Escape") { setOpen(false); trigger.focus(); }
  }, { signal });
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target as Node)) setOpen(false);
  }, { signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) setOpen(false);
  }, { signal });

  function update(next: readonly ExploreStockOption[]): void {
    const previous = select.value;
    options = next.filter(option=>option.value!=="");
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All Stocks";
    select.append(all);
    for (const option of options) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = `${option.symbol} ${option.name}`;
      select.append(item);
    }
    select.value = options.some((option) => option.value === previous) ? previous : "";
    renderCurrent();
    renderOptions();
  }

  update(initialOptions);
  select.addEventListener("change", () => { renderCurrent(); renderOptions(); }, { signal });

  return { update, destroy: () => { controller.abort(); root.remove(); } };
}
