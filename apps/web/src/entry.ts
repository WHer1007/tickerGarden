import {resolveRoute} from './routing/routes.ts';
import {renderRouteFailure} from './routing/load-state.ts';
// Public reading surfaces do not load wallet, ABI or financial dependencies.
const route = resolveRoute(new URL(location.href));
const staticPages = new Set(['home', 'docs', 'privacy', 'terms', 'not-found']);
void (staticPages.has(route.page) ? import('./routing/static-entry.ts') : import('./app.ts')).catch(() => {
  const outlet = document.querySelector<HTMLElement>('[data-route-outlet]');
  if (outlet) renderRouteFailure(outlet, () => location.reload());
});
