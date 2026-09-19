import { createRouter } from "../../src/routing/router.ts";
import type { Route } from "../../src/routing/routes.ts";

const outlet = document.querySelector<HTMLElement>("#outlet")!;
const result = document.querySelector<HTMLElement>("#result")!;
const log = document.querySelector<HTMLElement>("#log")!;
let assertions = 0;
let renders = 0;
let blocked = 0;
let allowed = true;
const checks: string[] = [];
const check = (condition: unknown, message: string) => {
  assertions++;
  if (!condition) throw new Error(message);
  checks.push(`PASS ${message}`);
};
const waitFor = async (condition: () => boolean, message: string, timeout = 2000) => {
  const end = performance.now() + timeout;
  while (!condition()) {
    if (performance.now() >= end) throw new Error(`Timed out: ${message}`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
};

const render = (route: Route) => {
  renders++;
  outlet.innerHTML = `<h2>${route.page}</h2><p>${route.href}</p>`;
};
history.replaceState(null, "", "/");
const router = createRouter({
  render,
  canNavigate: () => allowed,
  blocked: () => { blocked++; },
  hashChanged: route => { outlet.dataset.hash = route.hash; },
});

async function run() {
  router.start();
  await waitFor(() => renders === 1, "initial render");
  check(outlet.textContent?.includes("home"), "initial route renders in the outlet");

  document.querySelector<HTMLAnchorElement>("#markets")!.click();
  await waitFor(() => location.pathname === "/explore" && renders === 2, "same-document click");
  check(location.search === "?marketId=abc" && location.hash === "#positions", "click preserves query and hash");
  check(outlet.textContent?.includes("markets"), "click renders the target route");

  const beforeHashRender = renders;
  router.navigate("/explore?marketId=abc#activity");
  await waitFor(() => location.hash === "#activity", "hash-only navigation");
  check(renders === beforeHashRender, "hash-only navigation does not remount");

  router.replaceLocation("/explore?marketId=selected#activity");
  check(renders === beforeHashRender, "page-local selection replaces the URL without remounting");
  history.back();
  await waitFor(() => location.search === "?marketId=abc" && location.hash === "#positions", "back after page-local selection");
  check(renders === beforeHashRender + 1 && outlet.textContent?.includes("marketId=abc"), "back restores the earlier market after a page-local URL update");
  history.forward();
  await waitFor(() => location.search === "?marketId=selected", "forward after page-local selection");
  check(outlet.textContent?.includes("marketId=selected"), "forward renders the replaced market selection");

  const beforeDocsRender = renders;
  router.navigate("/docs");
  await waitFor(() => location.pathname === "/docs" && renders === beforeDocsRender + 1, "forward navigation");
  const docsUrl = location.href;
  history.back();
  await waitFor(() => location.pathname === "/explore" && location.hash === "#activity", "back navigation");
  check(outlet.textContent?.includes("markets"), "back updates the rendered route");
  history.forward();
  await waitFor(() => location.href === docsUrl, "forward navigation after back");

  allowed = false;
  const blockedUrl = location.href;
  document.querySelector<HTMLAnchorElement>("#home")!.click();
  await waitFor(() => blocked > 0, "blocked click");
  check(location.href === blockedUrl, "canNavigate false blocks click");
  history.back();
  await waitFor(() => blocked > 1 && location.href === blockedUrl, "blocked back restoration");
  check(location.href === blockedUrl, "canNavigate false restores back URL");
  check(outlet.textContent?.includes("docs"), "blocked back keeps the current outlet");

  router.stop();
  allowed = true;
  const stoppedRenders = renders;
  let defaultPreventedAfterStop = false;
  const stopProbe = (event: MouseEvent) => {
    defaultPreventedAfterStop = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", stopProbe, { once: true });
  document.querySelector<HTMLAnchorElement>("#home")!.click();
  check(!defaultPreventedAfterStop, "stop removes the router click handler");
  check(renders === stoppedRenders, "stop unbinds click handling");

  // Real delayed mounts: fragment positioning must happen after the target exists.
  let releaseDocs: (() => void) | undefined;
  let anchorScrolls = 0;
  history.replaceState(null, '', '/explore');
  const delayed = createRouter({
    async render(route) {
      outlet.replaceChildren();
      if (route.page === 'docs') await new Promise<void>(resolve => { releaseDocs = resolve; });
      outlet.innerHTML = '<h1>Ready</h1><section id="docs-risks">Risks</section><section id="docs-next">Next section</section>';
      outlet.querySelector<HTMLElement>('#docs-risks')!.scrollIntoView = () => { anchorScrolls++; };
    }, canNavigate: () => true, blocked() {},
  });
  delayed.start();
  await Promise.resolve();
  delayed.navigate('/docs#docs-risks');
  check(anchorScrolls === 0, 'fragment does not scroll before its async page exists');
  releaseDocs!();
  await waitFor(() => anchorScrolls === 1, 'fragment scroll after mount');
  check(anchorScrolls === 1, 'fragment scrolls after its page is mounted');
  delayed.navigate('/docs#docs-next');
  await waitFor(() => document.activeElement?.id === 'docs-next', 'same-page fragment receives keyboard focus');
  check(document.activeElement?.id === 'docs-next', 'same-page fragment moves keyboard focus to its target');
  delayed.stop();

  result.textContent = `PASS (${assertions} assertions)`;
  document.title = result.textContent;
  log.textContent = checks.join("\n");
}

run().catch(error => {
  result.textContent = "FAIL";
  log.textContent = `${error instanceof Error ? error.stack : String(error)}\nAssertions: ${assertions}`;
});
