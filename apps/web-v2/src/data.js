export const markets=[
{id:'nvcat',name:'NVIDIA CAT',symbol:'NVCAT',base:'NVDA',icon:'✳',color:'#d9ed96',price:0.0000428,change:24.68,cap:428000,volume:86200,progress:100,holders:1284,points:[15,21,18,30,26,38,33,45,40,56,49,63,60,77]},
{id:'teslab',name:'TESLA BUDS',symbol:'TBUD',base:'TSLA',icon:'✿',color:'#e9c2ee',price:0.0000312,change:18.42,cap:312000,volume:64500,progress:82,holders:968,points:[22,18,30,25,36,31,42,38,48,60,54,67]},
{id:'apple',name:'APPLE CORE',symbol:'CORE',base:'AAPL',icon:'◉',color:'#f5d098',price:0.0000286,change:8.76,cap:286000,volume:43100,progress:100,holders:856,points:[28,31,24,40,38,43,40,52,45,51,55,61]},
{id:'moon',name:'AMAZON MOON',symbol:'AMOON',base:'AMZN',icon:'☾',color:'#c2d9f1',price:0.0000194,change:-3.21,cap:194000,volume:32800,progress:64,holders:642,points:[66,60,65,52,59,48,54,43,50,41,47,39]},
{id:'meta',name:'META MOSS',symbol:'MOSS',base:'META',icon:'❋',color:'#b9dfcb',price:0.0000168,change:12.35,cap:168000,volume:24600,progress:46,holders:521,points:[15,23,20,28,22,35,39,32,48,42,52,62]},
{id:'coin',name:'COIN BLOOM',symbol:'CBLM',base:'COIN',icon:'✺',color:'#e8e4a0',price:0.0000112,change:6.92,cap:112000,volume:18400,progress:31,holders:384,points:[22,28,24,36,32,39,34,43,39,49,44,55]}
];
export const money=n=>'$'+Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n);
export const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function estimate(amount,price,side,slippage){if(!Number.isFinite(amount)||amount<=0||amount>1000000)return null;const output=side==='buy'?amount*2400/price:amount*price/2400;return {output:output*.99,min:output*.99*(1-slippage/100)};}
