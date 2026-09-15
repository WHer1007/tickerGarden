import test from 'node:test';import assert from 'node:assert/strict';import {checkRelease} from './check-release.mjs';
test('unknown or mismatched commit, image and schema block release',()=>{
 const expected={commit:'a'.repeat(40),imageDigest:'sha256:'+'b'.repeat(64),schemaDigest:'c'.repeat(32)};
 const observed={health:{ok:true,release:{...expected}},container:{Config:{Labels:{'org.opencontainers.image.revision':expected.commit}}},image:{RepoDigests:['repo@'+expected.imageDigest]}};
 assert.equal(checkRelease(expected,observed).ok,true);
 for(const key of ['commit','imageDigest','schemaDigest']){const copy=structuredClone(observed);copy.health.release[key]=null;assert.throws(()=>checkRelease(expected,copy));}
 assert.throws(()=>checkRelease(expected,{...observed,image:{RepoDigests:[]}}));
});

test('local image verification binds config digest, running container and image source label',()=>{
 const expected={commit:'a'.repeat(40),imageDigest:'sha256:'+'b'.repeat(64),schemaDigest:'c'.repeat(32),digestKind:'image-config'};
 const Config={Labels:{'org.opencontainers.image.revision':expected.commit}};
 const observed={health:{ok:true,release:{...expected}},container:{Config,Image:expected.imageDigest},image:{Config,Id:expected.imageDigest}};
 assert.equal(checkRelease(expected,observed).ok,true);
 for(const field of ['Image','Config']){const copy=structuredClone(observed);delete copy.container[field];assert.throws(()=>checkRelease(expected,copy));}
 const copy=structuredClone(observed);copy.image.Id='sha256:'+'d'.repeat(64);assert.throws(()=>checkRelease(expected,copy));
});
