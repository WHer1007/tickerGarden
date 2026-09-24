import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const moduleUrl=new URL('../services/backend-ts/packages/observability/src/index.ts',import.meta.url).href;
test('actual runtime logger prefers packaged source commit and records deployment ID',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tg-runtime-release-'));
 const env={...process.env,TG_RELEASE_COMMIT:'b'.repeat(40),VERCEL_DEPLOYMENT_ID:'dpl_fixture',TG_LOG_LEVEL:'info'};
 const run=()=>JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`import {logEvent} from ${JSON.stringify(moduleUrl)};logEvent('fixture','info','release_probe');`],{cwd:dir,env,encoding:'utf8'}).trim());
 try{
  assert.equal(run().releaseCommit,'b'.repeat(40));
  fs.writeFileSync(path.join(dir,'source-release.json'),JSON.stringify({schemaVersion:1,commit:'a'.repeat(40),branch:'master',target:'production',service:'read-api'}));
  const event=run();assert.equal(event.releaseCommit,'a'.repeat(40));assert.equal(event.deploymentId,'dpl_fixture');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('all backend function configs explicitly package source provenance',()=>{
 for(const name of ['read-api','pipeline','content']){
  const config=JSON.parse(fs.readFileSync(new URL(`../services/backend-ts/apps/${name}/vercel.json`,import.meta.url)));
  for(const fn of Object.values(config.functions))assert.equal(fn.includeFiles,'../../../../source-release.json');
 }
 const ignore=fs.readFileSync(new URL('../.vercelignore',import.meta.url),'utf8');assert.ok(!ignore.includes('source-release.json'));
});
