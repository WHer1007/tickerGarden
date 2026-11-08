# BSC Launch asset icons and paired-asset order

Status: locally validated; not published. Based on production Web commit `e8e694051506545bf7d0246d2cf0947ab51c23a5`, isolated in `codex/bsc-launch-asset-icons-20261108`.

Both Paired asset and Staking asset resolve registered bStocks to shared company branding. The 61 companies already in RH reuse the exact existing `/stock-logos/` URL; supplementary company logos, USDT and USDC are stored locally with source URLs and SHA-256 records in `apps/web/assets/company-logo-sources.json`. BNB reuses the existing chain icon. Existing BSC legacy SVG references no longer override shared RH stock images. There are no new runtime third-party image dependencies.

BSC Paired asset order is BNB, USDT, USDC, then SPCXB, NVDAB, TSLAB, AAPLB, MSFTB, AMZNB, GOOGLB, METAB, AVGOB, AMDB; remaining assets are alphabetic. The ten companies use the existing RH featured list. RH retains ETH/USDG and its original twenty featured stocks. Staking ordering, chain/token/UID identities, eligibility, risk limits and economic parameters are unchanged. GPROB remains excluded.

No stylesheet, page markup, contract, backend or production configuration was changed. Desktop (1440px) and mobile (390px) browser checks use the production bootstrap snapshot through a local read-only fixture: 80 paired options and loaded images, 77 staking options, search, selected image equality and refresh restoration all passed. RPC and mutation endpoints are disabled in the local preview. Browser evidence is in `.codex_tmp/launch-assets/browser.json` with screenshots alongside it.

Validation: frontend suite 797/797; generated ABI/client/catalog checks and TypeScript passed; production-style Vite build, asset/performance budgets and SEO checks passed. The preview is local only, at `http://127.0.0.1:4195/create?chain=bsc` while its process is running. No Vercel deployment, branch promotion or production mutation was performed for this change.
