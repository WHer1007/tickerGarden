import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('standalone worker uses scoped chain and release metadata loaded after module import',()=>{
 const url=new URL('../../packages/observability/src/index.ts',import.meta.url).href;
 const output=execFileSync(process.execPath,['--input-type=module','-e',`import {installProcessDiagnostics,logEvent} from ${JSON.stringify(url)}; installProcessDiagnostics('probe',{TG_ENVIRONMENT:'production',TG_CHAIN_ID:'56',TG_RELEASE_COMMIT:'${'b'.repeat(40)}',TG_SENTRY_DSN:''});logEvent('probe','info','identity_probe');`],{encoding:'utf8',env:{...process.env,TG_SENTRY_DSN:'',TG_RELEASE_COMMIT:'a'.repeat(40),TG_CHAIN_ID:'4663'}});
 const row=JSON.parse(output.trim());assert.equal(row.releaseCommit,'b'.repeat(40));assert.equal(row.chainId,'56');assert.equal(row.environment,'production');assert.ok(!output.includes('TG_SENTRY_DSN'));
});
