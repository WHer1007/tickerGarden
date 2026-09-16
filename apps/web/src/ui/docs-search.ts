const query = <T extends Element>(s: string) => document.querySelector<T>(s);
const queryAll = <T extends Element>(s: string) => Array.from(document.querySelectorAll<T>(s));
let disposePrevious: (() => void) | undefined;

export function setupDocs(): () => void {
  disposePrevious?.();
  const search = query<HTMLInputElement>("[data-docs-search]");
  const toc = query<HTMLElement>(".docs-toc");
  const sections = queryAll<HTMLElement>("[data-docs-section]");
  const links = queryAll<HTMLAnchorElement>(".docs-toc a");
  const listeners = new AbortController();
  let frame = 0;
  let active: HTMLAnchorElement | undefined;

  const sync = () => {
    frame = 0;
    const visible = sections.filter(section => !section.hidden);
    const headerBottom = query<HTMLElement>(".shell-header")?.getBoundingClientRect().bottom ?? 94;
    const anchorOffset = visible[0] ? parseFloat(getComputedStyle(visible[0]).scrollMarginTop) || 0 : 0;
    const threshold = Math.max(anchorOffset + 1, Math.max(0, headerBottom) + 24);
    let current = visible[0];
    for (const section of visible) {
      if (section.getBoundingClientRect().top <= threshold) current = section;
      else break;
    }
    const last = visible.at(-1);
    if (last && last.getBoundingClientRect().bottom <= innerHeight && last.getBoundingClientRect().top < innerHeight) current = last;
    const next = links.find(link => link.hash === `#${current?.id}`);
    if (next !== active) {
      active?.removeAttribute("aria-current");
      next?.setAttribute("aria-current", "location");
      active = next;
    }
    // Scroll only the desktop directory; never move the document or keyboard focus.
    if (active && toc && getComputedStyle(toc).position === "sticky") {
      const item = active.getBoundingClientRect(), bounds = toc.getBoundingClientRect();
      if (item.top < bounds.top + 8) toc.scrollTop += item.top - bounds.top - 8;
      else if (item.bottom > bounds.bottom - 8) toc.scrollTop += item.bottom - bounds.bottom + 8;
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
  const apply = () => {
    const needle = (search?.value ?? "").trim().toLowerCase();
    const articles = queryAll<HTMLElement>("[data-docs-article]");
    articles.forEach(item => { item.hidden = Boolean(needle && !item.textContent?.toLowerCase().includes(needle)); });
    sections.forEach(section => {
      section.hidden = !Array.from(section.querySelectorAll<HTMLElement>("[data-docs-article]")).some(item => !item.hidden);
    });
    const empty = query<HTMLElement>("[data-docs-empty]");
    if (empty) empty.hidden = articles.some(item => !item.hidden);
    schedule();
  };
  const events = { signal: listeners.signal };
  search?.addEventListener("input", apply, events);
  links.forEach(link => link.addEventListener("click", () => {
    if (search) search.value = "";
    apply();
  }, events));
  window.addEventListener("scroll", schedule, { ...events, passive: true });
  window.addEventListener("resize", schedule, events);
  window.addEventListener("hashchange", schedule, events);
  const resize = new ResizeObserver(schedule);
  const content = query<HTMLElement>(".docs-content");
  if (content) resize.observe(content);
  schedule();
  const dispose = () => {
    listeners.abort();resize.disconnect();cancelAnimationFrame(frame);
    if (disposePrevious === dispose) disposePrevious = undefined;
  };
  disposePrevious = dispose;
  return dispose;
}
