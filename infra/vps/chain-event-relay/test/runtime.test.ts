import test from 'node:test';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
test('relay server runs with the deployed Node strip-only TypeScript mode',()=>{
 for(const file of ['server.ts','core.ts'])assert.doesNotThrow(()=>stripTypeScriptTypes(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),{mode:'strip'}));
});
