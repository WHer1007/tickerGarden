export type NetworkKey = 'rh' | 'bsc';

/** A market, reward round or asset identifier must never cross network boundaries. */
export function networkDestination(current: URL, network: NetworkKey): string {
  const next = new URL(current);
  if (/^\/(trade|market)(\.html)?\/?$/.test(next.pathname)) next.pathname = '/explore';
  next.search = '';
  next.hash = '';
  next.searchParams.set('chain', network);
  return next.pathname + next.search;
}

export function bindNetworkSwitcher(header: HTMLElement, canSwitch: () => boolean): () => void {
  const trigger = header.querySelector<HTMLButtonElement>('[data-network-trigger]')!;
  const panel = header.querySelector<HTMLElement>('[data-network-panel]')!;
  const rows = [...panel.querySelectorAll<HTMLButtonElement>('[data-network]')];
  const enabled = rows.filter(row => !row.disabled);
  const controller = new AbortController();
  const events = {signal: controller.signal};
  function close(restoreFocus = false) {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }
  function open(last = false) {
    header.classList.remove('nav-open');
    const menu = header.querySelector<HTMLButtonElement>('[data-menu]');
    menu?.setAttribute('aria-expanded', 'false');
    menu?.setAttribute('aria-label', 'Open navigation');
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    (last ? enabled.at(-1) : enabled.find(row => row.getAttribute('aria-checked') === 'true') ?? enabled[0])?.focus();
  }
  trigger.addEventListener('click', () => panel.hidden ? open() : close(), events);
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault(); open(event.key === 'ArrowUp');}
  }, events);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close(true);}
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      enabled[next]?.focus();
    }
  }, events);
  for (const row of enabled) row.addEventListener('click', () => {
    if (row.getAttribute('aria-checked') === 'true') {close(true); return;}
    if (!canSwitch()) return;
    const network = row.dataset.network;
    if (network === 'rh' || network === 'bsc') window.location.assign(networkDestination(new URL(location.href), network));
  }, events);
  document.addEventListener('pointerdown', event => {
    if (!(event.target instanceof Node) || (!panel.contains(event.target) && !trigger.contains(event.target))) close();
  }, events);
  document.addEventListener('focusin', event => {
    if (event.target instanceof Node && !panel.contains(event.target) && !trigger.contains(event.target)) close();
  }, events);
  header.querySelector('[data-menu]')?.addEventListener('click', () => close(), events);
  return () => controller.abort();
}
