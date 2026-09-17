import type {LaunchPhase,LaunchState} from './launch-state.ts';
export const launchOperations = ['publish_details','preview_launch','refresh_funding','review_purchase','purchase_asset','approve_asset','simulate_launch','prepare_transaction','submit_launch','verify_launch'] as const;
export type LaunchOperation = typeof launchOperations[number];
export type LaunchDiagnostic = {reference:string;at:string;chainId:number;phase:LaunchPhase;operation:LaunchOperation;code:string;errorType:string;fingerprint:string;transactionMayBePending:boolean};
const codes = new Set(['pending_transaction','unsupported_chain','wrong_account','stale_quote','stale_snapshot','indexer_lagging','indexer_unavailable','simulation_failed','user_rejected','submission_failed','approval_reverted','transaction_reverted','replacement_cancelled','receipt_timeout','confirmation_failed','purchase_cost_changed']);
export function launchErrorCode(error:unknown):string {
 let current=error;
 for(let i=0;i<5 && current && typeof current==='object';i++){
  const e=current as {code?:unknown;message?:unknown;cause?:unknown};
  if(e.code===4001 || e.code==='4001')return 'user_rejected';
  if(typeof e.code==='string'&&codes.has(e.code))return e.code;
  const m=typeof e.message==='string'?e.message:'';
  for(const [pattern,code] of [
   [/Purchase cost changed/,'purchase_cost_changed'],[/Purchase quote expired/,'stale_quote'],[/Details Changed|Details changed/,'details_changed'],
   [/Wallet changed|wallet context changed|live wallet account/i,'wrong_account'],[/Invalid Upload Session/,'upload_session_invalid'],[/Purchase quote changed/,'purchase_quote_invalid'],
   [/Invalid publishing response|Published details missing/,'publishing_response_invalid'],[/Image gateway unavailable/,'image_gateway_unavailable'],
   [/Upload Authorization|Authorize Upload|Wallet Signature/,'upload_authorization_failed'],[/Publishing limit|Upload Limit/,'upload_limit'],
   [/Storage unavailable|Publishing failed/,'publishing_failed'],[/purchase route is not ready/,'purchase_route_unavailable'],
   [/insufficient (?:funds|balance)|ETH balance is below/i,'insufficient_funds'],[/timed? out|timeout|Failed to fetch|fetch failed|Cannot connect|HTTP request failed/i,'connection_failed']
  ] as const)if(pattern.test(m))return code;
  current=e.cause;
 }
 return 'unexpected_error';
}
export function launchFailureMessage(code:string,phase:LaunchPhase,pending:boolean):string {
 if(pending)return 'Your transaction outcome is not confirmed yet. Check your wallet history and keep tracking it. Do not submit another launch.';
 if(code==='purchase_cost_changed')return 'The ETH cost to buy your paired asset has changed. No purchase was submitted in this step. Return to the form and review the updated total before confirming again.';
 if(code==='stale_quote')return 'The purchase quote has expired. Return to the form to refresh the quote and review the total before confirming again.';
 if(code==='user_rejected')return 'The wallet request was declined. Return to the form when you are ready. Check your wallet for any earlier completed steps.';
 if(code==='insufficient_funds')return 'Your balance does not cover the amount and network fee. Review your wallet balance and the updated total.';
 if(phase==='publishing')return 'Your token details could not be prepared for launch. Return to the form and try again. If this continues, copy the support details and contact us.';
 return 'The launch stopped during preparation or verification. Check your wallet for any completed steps before trying again. Copy the support details if you need help.';
}
export async function recordLaunchFailure(storage:Pick<Storage,'getItem'|'setItem'>,state:LaunchState,operation:LaunchOperation,error:unknown,pending:boolean):Promise<LaunchDiagnostic>{
 const phase=state.failedFrom??state.phase;
 const message=error instanceof Error?`${error.name}:${error.message}`:typeof error;
 let fingerprint='unavailable';
 try{fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(message)))].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);}catch{}
 const name=error instanceof Error?error.name:'';
 const diagnostic:LaunchDiagnostic={reference:crypto.randomUUID(),at:new Date().toISOString(),chainId:state.chainId,phase,operation,code:launchErrorCode(error),errorType:['Error','TypeError','RangeError','DOMException','ContractFunctionExecutionError','TransactionExecutionError'].includes(name)?name:'OtherError',fingerprint,transactionMayBePending:pending};
 // Explicit fields only: never retain wallet signatures, RPC URLs, calldata, metadata or raw error messages.
 try{const key=`tickergarden:launch-diagnostics:${state.chainId}`;const parsed=JSON.parse(storage.getItem(key)??'[]');const records=Array.isArray(parsed)?parsed:[];storage.setItem(key,JSON.stringify([...records.slice(-19),diagnostic]));}catch{/* Diagnostics must never change the transaction outcome. */}
 return diagnostic;
}
