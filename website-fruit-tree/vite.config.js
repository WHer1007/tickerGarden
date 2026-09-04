import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, "index.html"),
        markets: resolve(import.meta.dirname, "markets.html"),
        trade: resolve(import.meta.dirname, "trade.html"),
        create: resolve(import.meta.dirname, "create.html"),
        stats: resolve(import.meta.dirname, "stats.html"),
        faq: resolve(import.meta.dirname, "faq.html"),
        rewards: resolve(import.meta.dirname, "rewards.html"),
        privacy: resolve(import.meta.dirname, "privacy.html"),
        terms: resolve(import.meta.dirname, "terms.html")
      }
    }
  }
});
