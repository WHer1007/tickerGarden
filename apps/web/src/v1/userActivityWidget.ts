import { TickerGardenApiError, TickerGardenV1Client, type UserActivityPage } from './generated/read-api.ts';
import { validateUserActivity } from './userActivity.ts';

// Compare known revision-bound fields independently of JSON property order.
const content = (p: UserActivityPage) => JSON.stringify([p.chainId, p.account, p.nextCursor, p.indexedFrom, p.sourceBlockNumber, p.sourceBlockHash, p.revision, p.finality, p.displayOnly,
  p.items.map(r => [r.id, r.chainId, r.account, r.roles, r.identityBasis, r.module, r.signature, r.emitter, r.blockNumber, r.blockHash, r.transactionHash, r.transactionIndex, r.logIndex, Object.keys(r.arguments).sort().map(key => [key, r.arguments[key]])])]);

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let cancel = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error('Activity request interrupted'));
    if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
  });
  return Promise.race([pending, interrupted]).finally(() => signal.removeEventListener('abort', cancel));
}

export interface ActivityTimers { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void }
const browserTimers: ActivityTimers = { set: (callback, ms) => setTimeout(callback, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export function mountUserActivity(root: HTMLElement, baseUrl: string | null, chain: number, timers: ActivityTimers = browserTimers) {
  let account: `0x${string}` | null = null, active = false, generation = 0;
  let head: UserActivityPage | null = null, pollTimer: unknown, failures = 0;
  let page: UserActivityPage | null = null, controller: AbortController | null = null;
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const list = document.createElement('div'); list.className = 'activity-list';
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh activity'; refresh.className = 'action-button';
  const more = document.createElement('button'); more.type = 'button'; more.textContent = 'Load more activity'; more.className = 'action-button'; more.hidden = true;
  const actions = document.createElement('div'); actions.className = 'form-actions'; actions.append(refresh, more);
  root.append(status, list, actions);
  const clear = () => { page = null; head = null; list.replaceChildren(); more.hidden = true; };
  const abort = () => { timers.clear(pollTimer); pollTimer = undefined; generation++; controller?.abort(); controller = null; root.setAttribute('aria-busy', 'false'); };
  const render = () => {
    list.replaceChildren(); if (!page) return;
    for (const record of page.items) {
      const card = document.createElement('article'); card.className = 'activity-card';
      const title = document.createElement('h3'); title.textContent = record.signature.split('(')[0]!.replace(/([a-z])([A-Z])/g, '$1 $2');
      const summary = document.createElement('p'); summary.textContent = `Block ${record.blockNumber} · Role: ${record.roles.join(', ')} · ${record.module}`;
      const tx = document.createElement('code'); tx.textContent = record.transactionHash; tx.setAttribute('aria-label', 'Transaction hash');
      const details = document.createElement('details'), label = document.createElement('summary'); label.textContent = 'Event details (raw values)'; details.append(label);
      const fields = document.createElement('dl');
      for (const [name, value] of Object.entries(record.arguments)) {
        const term = document.createElement('dt'), definition = document.createElement('dd'); term.textContent = name; definition.textContent = String(value); fields.append(term, definition);
      }
      details.append(fields); card.append(title, summary, tx, details); list.append(card);
    }
    status.textContent = `${page.account} · ${page.items.length ? `${page.items.length} activity records loaded` : 'No activity in this verified range'} · Blocks ${page.indexedFrom}–${page.sourceBlockNumber} (finalized).`;
    more.hidden = page.nextCursor === null;
  };
  const load = async (append = false, automatic = false) => {
    if (!active || !account || !baseUrl || (append && (controller || !page?.nextCursor))) return;
    abort(); const own = generation; const current = new AbortController(); controller = current;
    const wallet = account, previous = append ? page! : undefined;
    if (!append && !automatic) clear();
    root.setAttribute('aria-busy', 'true'); refresh.disabled = true; more.disabled = true; if (!automatic || !page) status.textContent = 'Loading finalized activity…';
    const timer = timers.set(() => current.abort(), 10000);
    try {
      const api = new TickerGardenV1Client(baseUrl, (input, init) => fetch(input, { ...init, signal: current.signal, cache: 'no-store' }));
      const raw = await abortable(api.listUserActivity({ address: wallet, limit: 50, ...(previous?.nextCursor ? { cursor: previous.nextCursor } : {}) }), current.signal);
      if (own !== generation) return;
      if (current.signal.aborted) throw new Error('Timed out');
      const next = validateUserActivity(raw, chain, wallet, 50, previous);
      if (automatic && page && head && page.revision === next.revision) {
        // observedAt is refreshed by the reader; all revision-bound content must
        // remain identical, including the original first-page cursor.
        if (content(head) !== content(next)) throw new Error('Activity revision content changed');
        page = { ...page, observedAt: next.observedAt }; head = next;
      } else {
        page = previous ? { ...next, items: [...previous.items, ...next.items] } : next;
        if (!previous) head = next;
        render();
      }
      failures = 0;
    } catch (error) {
      if (own !== generation) return;
      failures = Math.min(failures + 1, 3);
      clear(); status.textContent = error instanceof TickerGardenApiError && error.status === 409
        ? 'History changed. Refresh activity to restart from the first page.'
        : 'Activity history is unavailable or incomplete. Try refreshing later.';
    } finally {
      timers.clear(timer);
      if (own === generation) { controller = null; refresh.disabled = false; more.disabled = false; root.setAttribute('aria-busy', 'false');
        if (active && account && baseUrl) pollTimer = timers.set(() => { pollTimer = undefined; void load(false, true); }, Math.min(120000, 30000 * 2 ** failures));
      }
    }
  };
  refresh.onclick = () => { void load(); }; more.onclick = () => { void load(true); };
  status.textContent = 'Connect your wallet to view activity.'; refresh.disabled = true;
  return {
    setContext(value: `0x${string}` | null, visible: boolean) {
      if (value === account && visible === active) return;
      abort(); clear(); failures = 0; account = value; active = visible;
      refresh.disabled = !account || !active || !baseUrl;
      status.textContent = !account ? 'Connect your wallet to view activity.' : !baseUrl ? 'Activity API is not configured.' : 'Open the Activity tab to load history.';
      if (active) void load();
    },
    refresh() { if (!controller) void load(false, true); },
    stop() { abort(); clear(); active = false; refresh.disabled = true; status.textContent = 'Activity paused.'; },
  };
}
