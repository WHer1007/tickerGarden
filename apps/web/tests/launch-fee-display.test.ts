import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatUnits} from 'viem';
import {FIXED_LAUNCH_FEE_WEI,FIXED_LAUNCH_FEE_LABEL} from '../src/create/launch-fee-display.ts';
import create from '../src/pages/create.ts';
test('the displayed fixed fee matches the immutable Factory fee',()=>{
 const source=readFileSync(new URL('../../../contracts/src/v1/modules/TickerGardenFactoryV1.sol',import.meta.url),'utf8');
 const amount=source.match(/constant LAUNCH_FEE = ([\d_]+);/)?.[1];assert.ok(amount);
 assert.equal(FIXED_LAUNCH_FEE_WEI,BigInt(amount.replaceAll('_','')));
 assert.equal(FIXED_LAUNCH_FEE_LABEL,`${formatUnits(FIXED_LAUNCH_FEE_WEI,18)} ETH`);
 assert.match(source,/launchFee = LAUNCH_FEE;/);
 assert.ok(create.html.includes(`data-preview-launch-fee>${FIXED_LAUNCH_FEE_LABEL}</strong>`));
});
