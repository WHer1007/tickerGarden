import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chartFromTrades} from '../src/v1/tradeChart.ts';
import type {TokenDetailTrade} from '../src/v1/generated/read-api.ts';
const trade=(timestamp:number,price:string,index=0)=>({timestamp,price,eventKey:`tx:${index}`} as TokenDetailTrade);
test('uses the latest real execution in each interval without filling gaps',()=>{
 const chart=chartFromTrades([trade(7190,'2'),trade(7180,'1'),trade(7070,'0.5'),trade(8000,'99')],'1H',7199);
 assert.equal(chart.points.length,60);
 assert.equal(chart.points.at(-1)?.price,'2');
 assert.equal(chart.points.at(-2)?.price,null);
 assert.equal(chart.points.at(-3)?.price,'0.5');
});
test('time windows select history independently of the twenty visible rows',()=>{
 const trades=Array.from({length:40},(_,i)=>trade(100000-i*120,'0.00000000045',i));
 assert.equal(chartFromTrades(trades,'12H',100000).points.length,144);
 assert.equal(chartFromTrades(trades,'1D',100000).points.length,96);
 assert.equal(chartFromTrades([trade(1,'1')],'1H',100000).points.every(p=>p.price===null),true);
 assert.equal(chartFromTrades([trade(100000,'1')],'1H',100000).points.filter(p=>p.price!==null).length,1);
});
