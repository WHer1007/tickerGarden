import assert from 'node:assert/strict';
import test from 'node:test';
import {errorDiagnosticTags} from '../src/error-diagnostics.ts';
test('nested confirmation errors retain safe stage and RPC reason without private payloads',()=>{
 const cause={name:'HttpRequestError',status:403,details:'{"error":"rpc_target_not_allowed"}',url:'https://private.example/key',request:{signature:'private'}};
 const tags=errorDiagnosticTags({name:'V1TransactionError',cause:{name:'LaunchVerificationError',verificationStep:'deployment',cause}});
 assert.deepEqual(tags,{causeType:'HttpRequestError',verificationStep:'deployment',httpStatus:'403',rpcCode:'rpc_target_not_allowed'});
});
test('unknown messages, names, arbitrary codes and cycles do not leak into telemetry',()=>{
 const error:{cause?:unknown;name:string;details:string;body:{error:string}}={name:'secret-key',details:'secret payload',body:{error:'private-request'}};error.cause=error;
 assert.deepEqual(errorDiagnosticTags(error),{});
});
