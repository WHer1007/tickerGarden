// Local-only fixture. Uses an in-memory provider; it cannot sign or broadcast.
import type { InjectedProvider } from "../../src/ui/wallet-picker.ts";

const result = document.querySelector<HTMLElement>("#test-result")!;
const log = document.querySelector<HTMLElement>("#test-log")!;
const checks: string[] = [];
const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  checks.push(`PASS ${message}`);
};
const waitFor = async (condition: () => boolean, message: string) => {
  const end = performance.now() + 5000;
  while (!condition()) {
    if (performance.now() > end) throw new Error(`Timed out: ${message}`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
};
const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
const navigate = async (href: string, page: string) => {
  const link = document.createElement("a");
  link.href = href;
  document.body.append(link);
  link.click();
  link.remove();
  await waitFor(() => document.body.dataset.page === page, `route ${href}`);
  // Let route-local initialization settle before inspecting its effects.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
};

const originalFetch = window.fetch;
const originalSetInterval = window.setInterval.bind(window);
const originalClearInterval = window.clearInterval.bind(window);
const intervals = new Set<number>();
const providerListeners = new Map<string, Set<(...args: unknown[]) => void>>();
const walletMethods: string[] = [];
let releaseAccounts: ((accounts: string[]) => void) | undefined;
const account = "0x1111111111111111111111111111111111111111";
const provider: InjectedProvider = {
  async request({ method }) {
    walletMethods.push(method);
    if (method === "eth_chainId") return `0x${Number(import.meta.env.VITE_V1_CHAIN_ID || 4663).toString(16)}`;
    if (method === "eth_requestAccounts") return new Promise<string[]>(resolve => { releaseAccounts = resolve; });
    throw new Error(`Unexpected wallet method: ${method}`);
  },
  on(event, listener) {
    if (!providerListeners.has(event)) providerListeners.set(event, new Set());
    providerListeners.get(event)!.add(listener);
  },
  removeListener(event, listener) { providerListeners.get(event)?.delete(listener); },
};

async function run() {
  check(!import.meta.env.VITE_V1_READ_API_URL && !import.meta.env.VITE_V1_FACTORY_ADDRESS, "fixture requires an unconfigured, local-only runtime");
  window.addEventListener("error", event => failures.push(event.message));
  window.addEventListener("unhandledrejection", event => failures.push(String(event.reason)));
  window.fetch = async () => { throw new Error("Network disabled by app routing fixture"); };
  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = originalSetInterval(handler, timeout, ...args);
    // Vite's development websocket owns its own interval; only track app code.
    if (new Error().stack?.includes("/src/")) intervals.add(id);
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => { if (id !== undefined) intervals.delete(id); originalClearInterval(id); }) as typeof window.clearInterval;
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
    detail: { info: { name: "Routing fixture wallet", rdns: "test.routing", uuid: "routing-fixture" }, provider },
  }));
  window.addEventListener("eip6963:requestProvider", announce);
  history.replaceState(null, "", "/");
  await import("../../src/app.ts");
  check(document.body.dataset.page === "home", "real app mounts the home route");
  // These application-wide pollers are created once at module scope. Route
  // setup may add its own timers, but repeated transitions must not grow the
  // persistent baseline.
  await waitFor(() => intervals.size >= 3, "application-wide pollers initialize");
  const persistentIntervalBaseline = intervals.size;
  check(persistentIntervalBaseline === 3, `application keeps its three persistent pollers (${persistentIntervalBaseline} active intervals)`);
  button("[data-wallet]").click();
  button('[data-wallet-choice="routing-fixture"]').click();
  await waitFor(() => !!releaseAccounts, "mock wallet account prompt");
  await navigate("/create", "home");
  check(location.pathname === "/", "wallet connection blocks leaving the current route");
  releaseAccounts!([account]);
  await waitFor(() => button("[data-wallet]").dataset.state === "connected" && !document.querySelector<HTMLDialogElement>(".wallet-dialog")!.open, "connected mock wallet");
  check(button("[data-wallet]").textContent?.includes("0x111111…1111"), "connected wallet button shows the shortened address");

  const sequence = ["markets", "create", "stats", "rewards", "docs", "privacy", "terms", "risks", "home"];
  for (const pass of [1, 2]) {
    for (const page of sequence) {
      await navigate(page === "home" ? "/" : page === "markets" ? "/explore" : page === "rewards" ? "/claim" : `/${page}`, page);
      check(button("[data-wallet]").dataset.state === "connected", `${page} pass ${pass}: wallet survives same-document navigation`);
      check(document.querySelectorAll(".wallet-dialog").length === 1, `${page} pass ${pass}: only one wallet picker exists`);
      const routeIntervals = page === "rewards" ? 1 : 0;
      await waitFor(() => intervals.size >= persistentIntervalBaseline + routeIntervals, `${page} pass ${pass} timers initialize`);
      check(intervals.size === persistentIntervalBaseline + routeIntervals, `${page} pass ${pass}: route timers are scoped and do not grow (${intervals.size} active intervals)`);
    }
  }
  check(walletMethods.filter(method => method === "eth_requestAccounts").length === 1, "route changes do not reconnect the wallet");
  check([...providerListeners.values()].every(listeners => listeners.size === 1), "wallet listeners are not duplicated on route changes");
  await navigate(`/trade.html?marketId=0x${"ab".repeat(32)}`, "trade");
  await waitFor(() => !!document.querySelector<HTMLInputElement>("[data-trade-amount]"), "trade deep link fields");
  check(location.pathname === "/trade" && new URLSearchParams(location.search).get("marketId") === `0x${"ab".repeat(32)}`, "legacy trade deep link keeps the selected market");
  await navigate("/rewards.html?marketId=fixture#creator", "rewards");
  const rewardsRoot = document.querySelector("[data-route-outlet] main");
  check(location.search === "?marketId=fixture" && button("#rewards-tab-creator").getAttribute("aria-selected") === "true", "legacy Rewards deep link keeps query and active tab");
  await navigate("/claim?marketId=fixture#treasury", "rewards");
  check(document.querySelector("[data-route-outlet] main") === rewardsRoot && button("#rewards-tab-treasury").getAttribute("aria-selected") === "true", "hash navigation preserves the Claim controller");
  await navigate("/no-such-page", "not-found");
  check(document.querySelector("[data-route-outlet] h1")!.textContent === "Page not found", "unknown routes show the application 404");
  await navigate("/create", "create");
  check(button("[data-launch-submit]")?.disabled ?? document.querySelector<HTMLButtonElement>('[data-create-form] button[type="submit"]')!.disabled, "launch stays locked without runtime configuration");
  button("[data-wallet]").click();
  await waitFor(() => !!document.querySelector("[data-wallet-disconnect]"), "wallet dialog opens for disconnect");
  button("[data-wallet-disconnect]").click();
  await waitFor(() => button("[data-wallet]").dataset.state === "disconnected", "wallet disconnect completes");
  check(button("[data-wallet]").dataset.state === "disconnected", "disconnect works after repeated navigation");
  check([...providerListeners.values()].every(listeners => listeners.size === 0), "disconnect removes the mock provider listeners");
  await navigate("/docs", "docs");
  check(failures.length === 0, `no uncaught app errors: ${failures.join("; ")}`);
  window.removeEventListener("eip6963:requestProvider", announce);
  result.textContent = `PASS (${checks.length} assertions)`;
  document.title = result.textContent;
  log.textContent = checks.join("\n");
}

run().catch(error => {
  result.textContent = "FAIL";
  document.title = "FAIL — app routing lifecycle";
  log.textContent = `${checks.join("\n")}\n${error instanceof Error ? error.stack : String(error)}`;
}).finally(() => {
  window.fetch = originalFetch;
  for (const id of intervals) originalClearInterval(id);
  window.setInterval = originalSetInterval;
  window.clearInterval = originalClearInterval;
});
