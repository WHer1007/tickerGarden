import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabasePool} from '../../packages/db/src/index.ts';
test('explicit database CA enforces peer verification and rejects conflicting URL SSL settings',async()=>{
 const ca='-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
 const runtime={role:'read-api',env:{TG_DB_CA_PEM:ca}};
 const handle=createDatabasePool('postgresql://user:pass@db.example/app',{ssl:false},runtime);
 try{const ssl=handle.pool.options.ssl as import('node:tls').ConnectionOptions;assert.equal(ssl.ca,ca);assert.equal(ssl.rejectUnauthorized,true);assert.ok(ssl.checkServerIdentity);assert.equal(ssl.checkServerIdentity('localhost',{subjectaltname:'DNS:db.example'} as import('node:tls').PeerCertificate),undefined);assert.ok(ssl.checkServerIdentity('db.example',{subjectaltname:'DNS:other.example'} as import('node:tls').PeerCertificate));}finally{await handle.pool.end();}
 assert.throws(()=>createDatabasePool('postgresql://user:pass@db.example/app?sslmode=no-verify',{},runtime),/conflicting/);
 assert.throws(()=>createDatabasePool('postgresql://user:pass@db.example/app',{}, {role:'read-api',env:{TG_DB_CA_PEM:'bad'}}),/PEM/);
});
