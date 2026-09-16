import { quoteIconUrl } from "./quote-icons.ts";

export type QuotePickerOption = Readonly<{
  value: string;
  symbol: string;
  name: string;
  pending: boolean;
  logoUrl?: string;
}>;

type PickerController = {
  update(options: readonly QuotePickerOption[]): void;
  destroy(): void;
};

const controllers = new WeakMap<HTMLSelectElement, PickerController>();

function selectionContent(option: QuotePickerOption, compact = false): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const icon = document.createElement("img");
  icon.className = "quote-picker-icon";
  icon.src = option.logoUrl ?? quoteIconUrl(option.symbol) ?? "";
  icon.loading = "lazy";
  icon.onerror = () => { icon.hidden = true; };
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.className = "quote-picker-copy";
  const symbol = document.createElement("strong");
  symbol.textContent = option.symbol;
  const name = document.createElement("small");
  name.textContent = compact ? option.name : `${option.name}${option.pending ? " · Pending activation" : ""}`;
  copy.append(symbol, name);
  fragment.append(icon, copy);
  return fragment;
}

function createController(select: HTMLSelectElement): PickerController | undefined {
  const picker = select.closest<HTMLElement>("[data-quote-picker]");
  const trigger = picker?.querySelector<HTMLButtonElement>("[data-quote-trigger], .quote-picker-trigger");
  const current = picker?.querySelector<HTMLElement>("[data-quote-current]");
  const list = picker?.querySelector<HTMLElement>("[data-quote-options]");
  const panel = picker?.querySelector<HTMLElement>("[data-quote-panel]");
  const search = picker?.querySelector<HTMLInputElement>("[data-quote-search]");
  const empty = picker?.querySelector<HTMLElement>("[data-quote-empty]");
  if (!picker || !trigger || !current || !list || !panel || !search || !empty) return undefined;

  let options: readonly QuotePickerOption[] = [];
  const close = () => {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const focusOption = (index: number) => {
    const buttons = [...list.querySelectorAll<HTMLButtonElement>("[role=option]")];
    buttons[(index + buttons.length) % buttons.length]?.focus();
  };
  const open = () => {
    if (select.disabled || !options.length) return;
    search.value = "";
    renderOptions();
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    search.focus();
  };
  const renderCurrent = () => {
    const option = options.find(item => item.value === select.value) ?? options[0];
    current.replaceChildren();
    if (option) current.append(selectionContent(option, true));
    else current.textContent = select.selectedOptions[0]?.textContent ?? "No assets available";
  };
  const selectOption = (option: QuotePickerOption) => {
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    renderCurrent();
    close();
    trigger.focus();
  };
  const renderOptions = () => {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const filtered = options.filter(option => `${option.symbol} ${option.name}`.toLowerCase().includes(query));
    empty.hidden = filtered.length !== 0;
    filtered.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quote-picker-option";
      button.role = "option";
      button.dataset.value = option.value;
      button.setAttribute("aria-selected", String(option.value === select.value));
      button.append(selectionContent(option));
      button.addEventListener("click", () => selectOption(option));
      button.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          focusOption(index + (event.key === "ArrowDown" ? 1 : -1));
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          focusOption(event.key === "Home" ? 0 : filtered.length - 1);
        } else if (event.key === "Escape") {
          close();
          if (event.key === "Escape") {
            event.preventDefault();
            trigger.focus();
          }
        }
      });
      list.append(button);
    });
  };

  search.addEventListener("input", renderOptions);
  search.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(event.key === "ArrowDown" ? 0 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      list.querySelector<HTMLButtonElement>("[role=option]")?.click();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.focus();
    }
  });
  picker.addEventListener("focusout", event => {
    if (!picker.contains(event.relatedTarget as Node | null)) close();
  });
  trigger.addEventListener("click", () => panel.hidden ? open() : close());
  trigger.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open();
    } else if (event.key === "Escape") close();
  });
  select.addEventListener("change", () => {
    renderCurrent();
    list.querySelectorAll<HTMLElement>("[role=option]").forEach(row => row.setAttribute("aria-selected", String(row.dataset.value === select.value)));
  });
  const handleDocumentClick = (event: MouseEvent) => {
    if (!picker.contains(event.target as Node)) close();
  };
  document.addEventListener("click", handleDocumentClick);

  return {
    update(nextOptions) {
      options = nextOptions;
      renderOptions();
      renderCurrent();
    },
    destroy() {
      document.removeEventListener("click", handleDocumentClick);
    },
  };
}

export function updateQuotePicker(select: HTMLSelectElement, options: readonly QuotePickerOption[]): void {
  let controller = controllers.get(select);
  if (!controller) {
    controller = createController(select);
    if (!controller) return;
    controllers.set(select, controller);
  }
  controller.update(options);
}

export function destroyQuotePicker(select: HTMLSelectElement): void {
  const controller = controllers.get(select);
  if (!controller) return;
  controller.destroy();
  controllers.delete(select);
}
