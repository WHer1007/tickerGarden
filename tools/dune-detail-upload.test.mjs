import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadRow} from './dune-detail-upload.mjs';
const now=Date.now(),ts=Math.floor(now/1000);
const report={version:1,chainId:46630,displayOnly:true,marketId:'0x'+'1'.repeat(64),memeToken:'0x'+'2'.repeat(40),quoteAsset:'0x'+'3'.repeat(40),quoteDecimals:18,period:'1H',statistics:{price:null,volume24h:'0',volumeFrom:ts-86400,volumeTo:ts,volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE'},chart:null,trades:null,holders:null,fees:null,sources:{statistics:{provider:'indexer',asOf:ts,blockNumber:'100',blockHash:'0x'+'4'.repeat(64)}},reasons:{}};
test('export preserves source freshness and yields deterministic deduplication IDs',()=>{const a=uploadRow(report,now);assert.equal(a.as_of,ts);assert.equal(a.snapshot_id,uploadRow(report,now+1000).snapshot_id);assert.equal(JSON.parse(a.payload).statistics.volume24h,'0');assert.throws(()=>uploadRow(report,now+1_201_000));});
test('Dune output cannot be fed back to the uploader as indexer evidence',()=>{assert.throws(()=>uploadRow({...report,sources:{statistics:{...report.sources.statistics,provider:'dune',queryId:'1',executionId:'x',cachedAt:ts}}},now),/feedback/);});
