import test from 'node:test';import assert from 'node:assert/strict';
import {securityHeaders} from '../security/headers.mjs';
test('production policy prevents framing and script injection with bounded connections',()=>{
 const h=securityHeaders({VITE_V1_RPC_URL:'https://rpc.example',PINATA_JWT:'not-public'});
 assert.equal(h['X-Frame-Options'],'DENY');assert.equal(h['X-Content-Type-Options'],'nosniff');
 assert.match(h['Content-Security-Policy'],/frame-ancestors 'none'/);assert.match(h['Content-Security-Policy'],/script-src 'self';/);assert.match(h['Content-Security-Policy'],/https:\/\/rpc.example/);assert.doesNotMatch(h['Content-Security-Policy'],/not-public|unsafe-eval|ws:\/\//);assert.ok(h['Strict-Transport-Security']);
 assert.match(securityHeaders({},true)['Content-Security-Policy'],/ws:\/\/127/);
});
test('only the mainnet production build permits indexing',()=>{
 for(const env of [{},{VERCEL_ENV:'preview',VITE_V1_CHAIN_ID:'4663'},{VERCEL_ENV:'production',VITE_V1_CHAIN_ID:'46630'}])assert.equal(securityHeaders(env)['X-Robots-Tag'],'noindex, nofollow');
 assert.equal(securityHeaders({VERCEL_ENV:'production',VITE_V1_CHAIN_ID:'4663'})['X-Robots-Tag'],undefined);
});
