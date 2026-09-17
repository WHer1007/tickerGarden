export function renderTradeEmptyState(state: 'missing' | 'invalid' | 'unavailable' | 'preparing' | null): void {
  const empty = document.querySelector<HTMLElement>('[data-trade-empty]');
  const content = document.querySelector<HTMLElement>('[data-trade-market-content]');
  if (!empty || !content) return;
  empty.hidden = state === null;
  content.hidden = state !== null;
  const retry=empty.querySelector<HTMLButtonElement>('[data-trade-retry]');if(retry)retry.hidden=state!=='unavailable'&&state!=='preparing';
  if (state === null) return;
  const title = empty.querySelector<HTMLElement>('[data-trade-empty-title]');
  const description = empty.querySelector<HTMLElement>('[data-trade-empty-description]');
  if (title) title.textContent = state === 'missing' ? 'Choose a market to trade' : state === 'invalid' ? 'This market link is invalid' : state==='preparing'?'Preparing market details':'This market could not be loaded';
  if (description) description.textContent = state === 'missing'
    ? 'Explore community tokens and open a market to see its price, activity and trading options.'
    : state === 'invalid' ? 'Open a market from Explore to continue with the correct link.'
    : state==='preparing'?'Your market details will appear here automatically. There is no need to launch again.':'Try again shortly, or choose another market from Explore.';
  const loading = document.querySelector<HTMLElement>('[data-trade-page-loading]');
  if (loading) loading.hidden = true;
  document.querySelector('main.trade-live')?.setAttribute('aria-busy', 'false');
}
