import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,toHex} from 'viem';
import {stakeErrorMessage} from '../src/ui/stake-error.ts';
test('principal deficit gives a concrete reason without promising withdrawal safety',()=>{
 assert.match(stakeErrorMessage('execution reverted StockPrincipalDeficit',false),/principal shortfall.*New deposits are blocked/);
 assert.match(stakeErrorMessage(keccak256(toHex('StockPrincipalDeficit(bytes32,uint256,uint256)')).slice(0,10),false),/principal shortfall/);
 assert.equal(stakeErrorMessage('rejected',false),'Transaction cancelled.');
 assert.equal(stakeErrorMessage('StockPrincipalDeficit',true),'Confirmation pending. Check your wallet.');
 assert.equal(stakeErrorMessage('network timeout',false),'Unable to stake. Please try again.');
});
