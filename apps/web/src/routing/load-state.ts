/** Exists outside page chunks so navigation failures always have a visible exit. */
export function renderRouteLoading(outlet: HTMLElement): void {
  outlet.innerHTML = '<main id="main-content" class="page route-load-state" aria-busy="true"><p role="status">Loading page…</p></main>';
}
export function renderRouteFailure(outlet: HTMLElement, retry: () => void): void {
  outlet.innerHTML = `<main id="main-content" class="page route-load-state" tabindex="-1"><section role="alert"><h1>This page couldn’t be loaded</h1><p>Your connection may have been interrupted. Try again, or return home.</p><p>If you submitted a transaction, check your wallet history before submitting it again.</p><div class="not-found-actions"><button class="action-button" type="button" data-route-retry>Try again</button><a class="not-found-secondary" href="/" data-router-ignore>Back to home</a></div></section></main>`;
  outlet.querySelector<HTMLButtonElement>('[data-route-retry]')!.onclick = retry;
  outlet.querySelector<HTMLElement>('main')?.focus();
}
