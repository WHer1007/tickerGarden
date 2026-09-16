/** Six significant digits, preserving plain decimal notation for overview prices. */
export function compactPrice(value:string|undefined|null):string {
 if(!value||!/^\d+(?:\.\d+)?$/.test(value))return '-';
 const [whole,fraction='']=value.split('.');
 const places=Math.max(0,6-(whole!.replace(/^0+/,'').length||-(fraction.match(/^0*/)?.[0].length??0)));
 if(fraction.length<=places)return value.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
 let digits=BigInt(whole!+fraction.slice(0,places));
 if(Number(fraction[places])>=5)digits++;
 const raw=digits.toString().padStart(places+1,'0');
 return places?(raw.slice(0,-places)+'.'+raw.slice(-places)).replace(/0+$/,'').replace(/\.$/,''):raw;
}
