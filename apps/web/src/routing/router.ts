import { isRouteLink, resolveRoute, type Route } from "./routes.ts";

type Options = {
  render(route: Route): void | Promise<void>;
  canNavigate(): boolean;
  blocked(): void;
  hashChanged?(route: Route): void;
};

/** One history owner for navigation and route-local market / tab selections. */
export function createRouter(options: Options) {
  let current = resolveRoute(new URL(window.location.href));
  let index = Number.isInteger(window.history.state?.tgRouteIndex) ? window.history.state.tgRouteIndex as number : 0;
  let restoring = false;
  let navigation = 0;
  let mounted: Promise<void> = Promise.resolve();
  const scroll = new Map<number, readonly [number, number]>();
  const controller = new AbortController();
  const events = { signal: controller.signal };
  const location = () => resolveRoute(new URL(window.location.href));
  const state = (next: number) => ({ ...window.history.state, tgRouteIndex: next });

  function replaceLocation(href: string) {
    const url = new URL(href, window.location.href);
    const next = resolveRoute(url);
    if (url.origin !== window.location.origin || next.page !== current.page) throw new Error("Route-local URL updates must stay on the current page");
    current = next;
    window.history.replaceState(state(index), "", next.href);
  }

  function focusRoute(route: Route, position?: readonly [number, number]) {
    const heading = document.querySelector<HTMLElement>("[data-route-outlet] h1, [data-route-outlet] main");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    if (position) { window.scrollTo(...position); return; }
    let anchor: HTMLElement | null = null;
    try { anchor = route.hash ? document.getElementById(decodeURIComponent(route.hash.slice(1))) : null; } catch { /* Invalid fragment is not a route error. */ }
    if (anchor) anchor.scrollIntoView();
    else window.scrollTo(0, 0);
  }

  function commit(route: Route, position?: readonly [number, number], initial = false) {
    const changed = initial || route.key !== current.key;
    current = route;
    const generation = ++navigation;
    if (changed) mounted = Promise.resolve(options.render(route));
    else options.hashChanged?.(route);
    void mounted.then(() => {
      if (generation !== navigation || controller.signal.aborted) return;
      focusRoute(current, position);
    });
  }

  function navigate(href: string, replace = false): boolean {
    const url = new URL(href, window.location.href);
    if (!isRouteLink(url, window.location.origin)) return false;
    const next = resolveRoute(url);
    // Read the live URL: page controllers may have replaced a query or tab hash.
    current = location();
    if (next.href === current.href) return true;
    if (!options.canNavigate()) { options.blocked(); return false; }
    scroll.set(index, [window.scrollX, window.scrollY]);
    if (!replace) index++;
    window.history[replace ? "replaceState" : "pushState"](state(index), "", next.href);
    commit(next);
    return true;
  }

  function start() {
    window.history.scrollRestoration = "manual";
    window.history.replaceState(state(index), "", current.href);
    commit(current, undefined, true);
    document.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self") || link.hasAttribute("data-router-ignore")) return;
      const url = new URL(link.href);
      if (!isRouteLink(url, window.location.origin)) return;
      event.preventDefault();
      navigate(url.href);
    }, events);
    window.addEventListener("scroll", () => { scroll.set(index, [window.scrollX, window.scrollY]); }, { ...events, passive: true });
    window.addEventListener("popstate", () => {
      const nextIndex = Number.isInteger(window.history.state?.tgRouteIndex) ? window.history.state.tgRouteIndex as number : index;
      if (restoring) { restoring = false; return; }
      if (!options.canNavigate()) {
        options.blocked();
        const delta = index - nextIndex;
        if (delta) { restoring = true; window.history.go(delta); }
        else window.history.replaceState(state(index), "", current.href);
        return;
      }
      index = nextIndex;
      const route = location();
      window.history.replaceState(state(index), "", route.href);
      commit(route, scroll.get(index));
    }, events);
    window.addEventListener("hashchange", () => {
      if (restoring) return;
      // Native fragment changes (address bar / assistive navigation) also select Rewards tabs.
      const next = location();
      if (next.href !== current.href) commit(next);
    }, events);
  }

  return { start, navigate, replaceLocation, stop() { controller.abort(); window.history.scrollRestoration = "auto"; } };
}
