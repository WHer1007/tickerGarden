import {test} from 'node:test';
import assert from 'node:assert/strict';
import {networkDestination} from '../src/ui/network-switcher.ts';

test('chain switch removes asset, round, wallet and market selections', () => {
  assert.equal(networkDestination(new URL('https://tickergarden.com/stake?chain=rh&asset=0x123&round=7#claim'),'bsc'),'/stake?chain=bsc');
});
test('market details return to destination network directory', () => {
  for (const path of ['/trade','/trade.html','/market']) assert.equal(networkDestination(new URL(`https://tickergarden.com${path}?market=0x123`),'bsc'),'/explore?chain=bsc');
});
test('same general page retained and RH selection explicit', () => {
  assert.equal(networkDestination(new URL('https://tickergarden.com/stats?chain=bsc'),'rh'),'/stats?chain=rh');
});

import {shellMarkup} from '../src/ui/shell.ts';
test('header selection and footer identity agree for each chain', () => {
  for (const name of ['Robinhood Chain','BNB Chain']) {
    const markup=shellMarkup('markets',name);
    assert.ok(markup.header.includes(`current: ${name}`));
    assert.ok(markup.footer.includes(`>${name}</span>`));
    assert.match(markup.header,/data-network="solana" disabled/);
    if(name==='BNB Chain')assert.match(markup.header,/href="\/explore\?chain=bsc"/);
  }
});
test('selected historical header keeps icon controls and removes view-only copy only for approved BSC writes',()=>{
 const enabled=shellMarkup('create','BNB Chain',true),disabled=shellMarkup('create','BNB Chain',false);
 assert.match(enabled.header,/class="network-trigger"/);assert.match(enabled.header,/class="wallet wallet-icon"/);
 assert.doesNotMatch(enabled.header,/View only/);assert.match(disabled.header,/View only/);
 assert.match(enabled.header,/data-network="solana" disabled/);assert.doesNotMatch(enabled.header,/href="\/stocks/);
});
