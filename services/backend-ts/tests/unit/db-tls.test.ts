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
test('database client certificates require a complete verified TLS configuration',async()=>{
 const cert='-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
 const key='-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
 const connection='postgresql://user:pass@db.example/app';
 for(const env of [{TG_DB_CLIENT_CERT_PEM:cert},{TG_DB_CA_PEM:cert,TG_DB_CLIENT_CERT_PEM:cert},{TG_DB_CA_PEM:cert,TG_DB_CLIENT_KEY_PEM:key}]){
  assert.throws(()=>createDatabasePool(connection,{}, {role:'read-api',env}),/client authentication/);
 }
 const handle=createDatabasePool(connection,{}, {role:'read-api',env:{TG_DB_CA_PEM:cert,TG_DB_CLIENT_CERT_PEM:cert,TG_DB_CLIENT_KEY_PEM:key}});
 try{const ssl=handle.pool.options.ssl as import('node:tls').ConnectionOptions;assert.equal(ssl.cert,cert);assert.equal(ssl.key,key);assert.equal(ssl.rejectUnauthorized,true);}finally{await handle.pool.end();}
});
