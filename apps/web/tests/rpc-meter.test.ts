import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcBytes,rpcElapsed} from '../server/rpc-meter.ts';

test('RPC telemetry helpers report UTF-8 byte size and non-negative elapsed time',()=>{
  assert.equal(rpcBytes('é'),2);
  assert.equal(rpcElapsed(performance.now()+1)>=0,true);
});
