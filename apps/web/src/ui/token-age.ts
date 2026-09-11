export function tokenAge(timestamp:string|undefined,now=Date.now()):string{
 if(!timestamp||!/^\d+$/.test(timestamp))return '-';
 const seconds=Number(timestamp);if(!Number.isSafeInteger(seconds)||seconds<=0)return '-';
 const elapsed=Math.max(0,Math.floor(now/1000)-seconds);
 if(elapsed<60)return 'Just now';
 if(elapsed<3600){const n=Math.floor(elapsed/60);return `${n} min ago`;}
 if(elapsed<86400){const n=Math.floor(elapsed/3600);return `${n} ${n===1?'hour':'hours'} ago`;}
 const days=Math.floor(elapsed/86400);return `${days} ${days===1?'day':'days'} ago`;
}
