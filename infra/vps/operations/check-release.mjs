import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// observed must come from live docker inspect and SQL/health capture, not the build configuration.
export function checkRelease(expected,observed){
 assert.match(expected.commit,/^[a-f0-9]{40}$/);
 assert.match(expected.imageDigest,/^sha256:[a-f0-9]{64}$/);
 assert.match(expected.schemaDigest,/^[a-f0-9]{32}$/);
 assert.equal(observed.health?.ok,true,'service not healthy');
 assert.equal(observed.health.release?.commit,expected.commit,'health commit mismatch');
 assert.equal(observed.container?.Config?.Labels?.['org.opencontainers.image.revision'],expected.commit,'image commit mismatch');
 if(expected.digestKind==='image-config'){
  assert.equal(observed.image?.Id,expected.imageDigest,'local image config digest mismatch');
  assert.equal(observed.container?.Image,expected.imageDigest,'container does not use verified local image');
  assert.equal(observed.image?.Config?.Labels?.['org.opencontainers.image.revision'],expected.commit,'local image source commit mismatch');
 }else{
  assert.ok(expected.digestKind===undefined||expected.digestKind==='registry-manifest','unknown digest kind');
  assert.ok(observed.image?.RepoDigests?.some(value=>value.endsWith('@'+expected.imageDigest)),'actual pulled image digest missing or different');
 }
 assert.equal(observed.health.release?.imageDigest,expected.imageDigest,'runtime digest mismatch');
 assert.equal(observed.health.release?.schemaDigest,expected.schemaDigest,'live schema mismatch');
 return {ok:true,commit:expected.commit,imageDigest:expected.imageDigest,schemaDigest:expected.schemaDigest};
}
if(process.argv[1]?.endsWith('/check-release.mjs')){
 const [expected,observed]=process.argv.slice(2);if(!expected||!observed)throw Error('usage: check-release.mjs expected.json observed.json');
 console.log(JSON.stringify(checkRelease(JSON.parse(await readFile(expected,'utf8')),JSON.parse(await readFile(observed,'utf8')))));
}
