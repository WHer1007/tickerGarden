import type {LaunchPhase,LaunchState} from './launch-state.ts';
export const launchOperations = ['publish_details','preview_launch','refresh_funding','review_purchase','purchase_asset','approve_asset','simulate_launch','prepare_transaction','submit_launch','verify_launch'] as const;
export type LaunchOperation = typeof launchOperations[number];
export type LaunchDiagnostic = {reference:string;at:string;chainId:number;phase:LaunchPhase;operation:LaunchOperation;code:string;errorType:string;fingerprint:string;transactionMayBePending:boolean};
const codes = new Set(['wallet_response_timeout','pending_transaction','unsupported_chain','wrong_account','stale_quote','stale_snapshot','indexer_lagging','indexer_unavailable','simulation_failed','user_rejected','submission_failed','approval_reverted','transaction_reverted','replacement_cancelled','receipt_timeout','confirmation_failed','purchase_cost_changed','purchase_route_unavailable','purchase_quote_invalid','upload_session_invalid','upload_authorization_failed','upload_limit','publishing_failed','publishing_response_invalid','image_gateway_unavailable','connection_failed','insufficient_funds','details_changed']);
export function launchErrorCode(error:unknown):string {
 let current=error;
 for(let i=0;i<5 && current && typeof current==='object';i++){
  const e=current as {code?:unknown;message?:unknown;cause?:unknown};
  if(e.code===4001 || e.code==='4001')return 'user_rejected';
  if(typeof e.code==='string'&&codes.has(e.code))return e.code;
  const m=typeof e.message==='string'?e.message:'';
  for(const [pattern,code] of [
   [/Purchase cost changed/,'purchase_cost_changed'],[/Purchase quote expired/,'stale_quote'],[/Details Changed|Details changed/,'details_changed'],
   [/Wallet changed|wallet context changed|live wallet account|account changed|chain changed|wrong network|unsupported chain/i,'wrong_account'],[/Invalid Upload Session|upload session.*(?:invalid|expired|not found)/i,'upload_session_invalid'],[/Purchase quote changed/,'purchase_quote_invalid'],
   [/Invalid publishing response|Published details missing/,'publishing_response_invalid'],[/Image gateway unavailable/,'image_gateway_unavailable'],
   [/Upload Authorization|Authorize Upload|Wallet Signature|publishing authorization|upload signature/i,'upload_authorization_failed'],[/Publishing limit|Upload Limit|rate limit|too many requests|HTTP 429/i,'upload_limit'],
   [/Storage unavailable|Publishing failed/,'publishing_failed'],[/purchase route is not ready|no .*route|route unavailable|unsupported (?:quote )?asset/i,'purchase_route_unavailable'],
   [/insufficient (?:funds|balance)|ETH balance is below/i,'insufficient_funds'],[/timed? out|timeout|Failed to fetch|fetch failed|Cannot connect|HTTP request failed/i,'connection_failed']
  ] as const)if(pattern.test(m))return code;
  current=e.cause;
 }
 return 'unexpected_error';
}
export function launchFailureMessage(code:string,phase:LaunchPhase,pending:boolean):string {
 if(pending)return 'The app is checking the transaction automatically. Wait for the result before trying again.';
 if(code==='wrong_account'||code==='unsupported_chain')return 'Your wallet account or network changed. Switch back to the account and network shown in the app, then review the launch again.';
 if(code==='purchase_checked')return 'The paired-asset purchase result has been checked. The launch was not sent. Return to the form and continue with your updated wallet balance.';
 if(code==='upload_authorization_failed')return 'The upload authorization was not completed, so your token details were not published. Return to the form and sign the publishing request when ready.';
 if(code==='upload_session_invalid')return 'The publishing session expired or is no longer valid. Return to the form and retry publishing your details.';
 if(code==='upload_limit')return 'Too many publishing requests were made. Wait a little, then retry publishing your details.';
 if(code==='connection_failed')return phase==='publishing'?'The connection interrupted publishing your token details. Check your network connection, then retry publishing from the form.':'The connection failed while preparing the launch. Check your network connection, then return to the form and retry.';
 if(code==='purchase_cost_changed')return 'The updated purchase cost exceeds your confirmed ETH limit (including the 10% allowance). No purchase was submitted in this step. Return to the form and review the updated total before confirming again.';
 if(code==='stale_quote')return 'The purchase quote has expired. Return to the form to refresh the quote and review the total before confirming again.';
 if(code==='wallet_response_timeout')return 'Your wallet did not return a submission result within 20 seconds. The request may still complete; any late transaction will be checked automatically.';
 if(code==='user_rejected')return phase==='publishing'?'The publishing signature was declined. Your token details were not published. Return to the form when ready.':'The wallet request was declined. Return to the form when ready; any earlier completed purchase or approval remains in place.';
 if(code==='publishing_failed'||code==='publishing_response_invalid'||code==='image_gateway_unavailable'||phase==='publishing')return 'Your token details could not be published. Check your connection and retry from the form; contact support if it continues.';
 if(code==='insufficient_funds')return 'Your balance does not cover the amount and network fee. Review your wallet balance and the updated total.';
 if(code==='approval_reverted')return 'The asset approval failed. The launch was not submitted. Review the asset and wallet, then retry approval when ready.';
 if(code==='simulation_failed')return 'The launch could not pass its safety check, so it was not submitted. Review the launch details and current quote before trying again.';
 if(code==='purchase_route_unavailable'||code==='purchase_quote_invalid')return 'A route to buy the missing paired asset is unavailable right now. You can add that asset to your wallet or try again later.';
 if(code==='transaction_reverted')return 'The launch transaction failed onchain, so no token was created. Earlier purchases or approvals remain in place; review the launch and updated balance before trying again.';
 if(code==='replacement_cancelled')return 'The launch transaction was cancelled, so no token was created. Earlier purchases or approvals remain in place; return to the form when ready.';
 if(code==='stale_snapshot'||code==='details_changed')return 'The launch details or wallet state changed. Return to the form, review the current details and confirm again.';
 if(code==='indexer_lagging'||code==='indexer_unavailable')return 'The market data service is temporarily unavailable, so launch preparation could not finish. Check your connection and try again later.';
 if(code==='receipt_timeout'||code==='confirmation_failed'||code==='pending_transaction')return 'The app is checking the transaction automatically. Wait for the result before trying again.';
 if(phase==='approval')return 'The asset approval did not complete, so launch has not continued. Review the asset and retry when ready.';
 if(phase==='preparing')return 'The launch could not be prepared. Review your details, wallet balance and current quote, then try again.';
 return 'The launch stopped before completion. Review any completed purchase or approval before continuing, and contact support with the error reference if needed.';
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
