// Reading public documents does not require the wallet or financial runtime.
const staticPaths = new Set(['/docs', '/privacy', '/terms', '/risks']);
if (staticPaths.has(location.pathname.replace(/\/$/, ''))) {
  void import('./routing/static-entry.ts');
} else {
  void import('./app.ts');
}
