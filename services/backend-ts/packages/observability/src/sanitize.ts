/** A log event is not a request dump. Only allowlisted operational context crosses this boundary. */
const allowed = new Set(['event','code','flow','step','operationId','requestId','jobId','attempt','queue','outcome','durationMs','retryable','status','method','path','marketId','chainId','count','failed','provider','generation','phase','reference','sent','retry','dead','requestBytes','responseBytes','nominalComputeUnits','computeUnitSchedule']);
export function cleanText(value:string,max=1200):string {
 return value.replace(/-----BEGIN[\s\S]*?-----END[^\n]*?-----/g,'[redacted-key]')
  .replace(/(?:https?|wss?|postgres(?:ql)?):\/\/[^\s<>"']+/gi,'[redacted-url]')
  .replace(/\b(?:Bearer|Basic)\s+\S+/gi,'[redacted-auth]')
  .replace(/\b(?:authorization|cookie|signature|private[_-]?key|secret|password|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,'[redacted-field]')
  .replace(/0x[0-9a-f]{40,}/gi,'[redacted-hex]')
  .replace(/\b[A-Za-z0-9_+/=-]{48,}\b/g,'[redacted-value]')
  .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,'[redacted-email]').slice(0,max);
}
export function safeContext(input:Record<string,unknown>):Record<string,string|number|boolean> {
 const result:Record<string,string|number|boolean>={};
 for(const [key,value] of Object.entries(input))if(allowed.has(key)){
  if(typeof value==='string')result[key]=cleanText(value,240);
  else if(typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean')result[key]=value as number|boolean;
 }
 return result;
}
export function safeError(error:unknown,depth=0):Record<string,unknown> {
 if(depth>2)return {type:'CauseLimit'};
 if(!(error instanceof Error))return {type:'NonError',message:typeof error==='string'?cleanText(error):'Non-Error rejection'};
 return {type:cleanText(error.name,80),message:cleanText(error.message),
  ...(error.stack?{stack:cleanText(error.stack,5000)}:{}),
  ...('code'in error&&(typeof error.code==='string'||typeof error.code==='number')?{code:cleanText(String(error.code),80)}:{}),
  ...(error.cause?{cause:safeError(error.cause,depth+1)}:{})};
}
