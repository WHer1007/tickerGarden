import test from 'node:test';
import assert from 'node:assert/strict';
import {ownsCreatorRewards} from '../src/v1/creatorOwnership.ts';
const creator='0xabcdef0123456789abcdef0123456789abcdef01';
const other='0x1234567890123456789012345678901234567890';
test('creator rewards require the connected wallet to match the recorded beneficiary',()=>{
 assert.equal(ownsCreatorRewards(creator,creator),true);
 assert.equal(ownsCreatorRewards('0x'+creator.slice(2).toUpperCase(),creator),true);
 assert.equal(ownsCreatorRewards(other,creator),false);
 assert.equal(ownsCreatorRewards(undefined,creator),false);
 assert.equal(ownsCreatorRewards(creator,other),false);
 assert.equal(ownsCreatorRewards('0x'+'0'.repeat(40),'0x'+'0'.repeat(40)),false);
 assert.equal(ownsCreatorRewards('not-an-address','not-an-address'),false);
});
