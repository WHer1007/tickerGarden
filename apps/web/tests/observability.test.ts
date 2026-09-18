import test from 'node:test';
import assert from 'node:assert/strict';
import {reportClientError,startObservability} from '../src/observability.ts';
import {securityHeaders} from '../security/headers.mjs';
test('unconfigured telemetry is inert and never changes business errors',async()=>{
 const fetcher=globalThis.fetch;let called=false;globalThis.fetch=(async()=>{called=true;throw Error('must not send');}) as typeof fetch;
 try{reportClientError(new Error('failure'),{flow:'launch',step:'publish'});reportClientError({code:4001});await startObservability();assert.equal(called,false);}finally{globalThis.fetch=fetcher;}
});
test('CSP permits the configured Sentry ingest origin without exposing its public key',()=>{
 const csp=securityHeaders({VITE_SENTRY_DSN:'https://public-ingest-key@o123.ingest.sentry.io/456'})['Content-Security-Policy'];assert(csp.includes('https://o123.ingest.sentry.io'));assert(!csp.includes('public-ingest-key'));
});
