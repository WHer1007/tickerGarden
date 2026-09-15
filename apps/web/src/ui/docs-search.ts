const query = <T extends Element>(s: string) => document.querySelector<T>(s);
const queryAll = <T extends Element>(s: string) => Array.from(document.querySelectorAll<T>(s));
export function setupDocs(): void {
  const search = query<HTMLInputElement>("[data-docs-search]");
  const apply = () => {
    const needle = (search?.value ?? "").trim().toLowerCase();
    const articles = queryAll<HTMLElement>("[data-docs-article]");
    articles.forEach((item) => {
      item.hidden = Boolean(needle && !item.textContent?.toLowerCase().includes(needle));
    });
    queryAll<HTMLElement>("[data-docs-section]").forEach((section) => {
      section.hidden = !Array.from(section.querySelectorAll<HTMLElement>("[data-docs-article]")).some(item => !item.hidden);
    });
    const empty = query<HTMLElement>("[data-docs-empty]");
    if (empty) empty.hidden = articles.some((item) => !item.hidden);
  };
  search?.addEventListener("input", apply);
  queryAll<HTMLAnchorElement>(".docs-toc a").forEach((link) => link.addEventListener("click", () => {
    if (search) search.value = "";
    apply();
  }));
}
