# UI fonts

Verified 2026-09-09 against https://www.ponsfamily.com/launchpad and its CSS:
- /_next/static/immutable/chunks/34ipm3h5o10ml.css
- /_next/static/immutable/chunks/3yt4nl_lcnfl_.css

Pons uses Inter Variable (100–900) for its sans-serif UI and Instrument Serif (400) for serif display text. The included Latin and Latin Extended WOFF2 subsets match its published font assets. Fonts are served locally via apps/web/fonts.css. Existing icon fonts and artwork remain separate; address/code monospace is retained.

Both families are licensed under SIL OFL 1.1. License copies are included from:
- https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt
- https://github.com/google/fonts/blob/main/ofl/instrumentserif/OFL.txt

Product override: titles now also use Inter Variable. Instrument Serif files are retained with their license as reference assets, but are no longer declared or loaded by the application.
