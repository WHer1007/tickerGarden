import { defineConfig } from "vite";

export default defineConfig({
  appType: "spa",
  // Environment is supplied by tools/environment.mjs; never load a stale per-app .env.
  envDir: false,
});
