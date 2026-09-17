import test from 'node:test';
import assert from 'node:assert/strict';

test('creation receipt appears in the open chart interval without waiting for finalized history',async()=>{
 const {creationReceiptChart}=await import('../src/v1/detailChart.ts');
 const now=1720000010;
 const detail:any={confirmation:'confirmed',sources:{trades:{asOf:now}},trades:[{timestamp:now,price:'0.01'}]};
 for(const period of ['1H','12H','1D'] as const){const chart=creationReceiptChart(detail,period)!;assert.ok(chart.to>now);assert.equal(chart.points.at(-1)?.price,'0.01');assert.equal(chart.points.filter(p=>p.price!==null).length,1);}
 assert.equal(creationReceiptChart({...detail,confirmation:undefined},'1H'),null);
 assert.ok(creationReceiptChart({...detail,trades:[]},'1H')!.points.every(p=>p.price===null));
});
