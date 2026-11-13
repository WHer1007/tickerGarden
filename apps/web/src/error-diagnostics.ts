// Low-cardinality classifications only; never serialize causes or request data.
const types=new Set(['Error','TypeError','HttpRequestError','ContractFunctionExecutionError','ContractFunctionRevertedError','CallExecutionError','TransactionExecutionError','LaunchVerificationError','V1TransactionError']);
const rpcCodes=new Set(['rpc_target_not_allowed','rpc_event_not_allowed','rpc_method_not_allowed','rpc_rate_limited','rpc_upstream_unavailable','origin_not_allowed']);
export function errorDiagnosticTags(error:unknown):Record<string,string>{
 const tags:Record<string,string>={},seen=new Set<unknown>();let value=error;
 for(let i=0;i<5&&value&&typeof value==='object'&&!seen.has(value);i++){
  seen.add(value);const e=value as {name?:unknown;status?:unknown;cause?:unknown;verificationStep?:unknown;details?:unknown;body?:{error?:unknown}};
  if(typeof e.name==='string'&&types.has(e.name))tags.causeType=e.name;
  if(typeof e.status==='number'&&Number.isInteger(e.status)&&e.status>=400&&e.status<=599)tags.httpStatus=String(e.status);
  if(['receipt','registration','deployment'].includes(String(e.verificationStep)))tags.verificationStep=String(e.verificationStep);
  let code=e.body?.error;
  if(typeof e.details==='string'&&e.details.length<=1024){try{code=JSON.parse(e.details)?.error??code;}catch{/* Do not retain arbitrary provider messages. */}}
  if(typeof code==='string'&&rpcCodes.has(code))tags.rpcCode=code;
  value=e.cause;
 }
 return tags;
}
