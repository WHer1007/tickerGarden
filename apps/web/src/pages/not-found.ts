import type {PageTemplate} from "../routing/pages.ts";
export const notFound: PageTemplate = {
  title: "Page not found — TickerGarden",
  html: `<main class="page not-found-page">
    <section class="not-found-content" aria-labelledby="not-found-title">
      <p class="not-found-code" aria-hidden="true">404</p>
      <p class="not-found-eyebrow">A little off the garden path</p>
      <h1 id="not-found-title">Page not found</h1>
      <p class="not-found-description">This page may have moved, or the link may be incorrect.<br>There’s still plenty to explore in the garden.</p>
      <nav class="not-found-actions" aria-label="Find your way back">
        <a class="not-found-primary" href="/explore">Explore the garden<i class="ph ph-arrow-right" aria-hidden="true"></i></a>
        <a class="not-found-secondary" href="/">Back to home</a>
      </nav>
      <p class="not-found-help">Need a hand? <a href="/docs#docs-help" data-router-ignore>Contact us</a></p>
    </section>
  </main>`,
};
