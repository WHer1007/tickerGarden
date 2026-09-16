import assert from "node:assert/strict";
import test from "node:test";
import { pageMetadata, renderMetadata } from "../src/routing/metadata.ts";
test("metadata strips query and hash from canonical URLs",()=>{const metadata=pageMetadata("trade","/trade?marketId=abc#details");assert.equal(metadata.canonical,"https://tickergarden.com/trade");assert.equal(metadata.robots,"index,follow");});
test("not-found is noindex and valid routes are indexable",()=>{assert.equal(pageMetadata("not-found","/missing?x=1").robots,"noindex,follow");assert.equal(pageMetadata("statsStocks","/stats/stocks").robots,"index,follow");});
test("renderMetadata emits social metadata without unverified images",()=>{const html=renderMetadata("docs","/docs");assert.match(html,/og:site_name/);assert.match(html,/twitter:card/);assert.doesNotMatch(html,/og:image|twitter:image/);});
