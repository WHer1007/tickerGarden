import {publicError} from '../ui/public-error.ts';
/** Only say a request was not submitted while no wallet write was requested. */
export function tradeSubmissionError(error:unknown,walletRequested:boolean):string{
 let current=error,code='',message='';
 for(let depth=0;depth<5&&current&&typeof current==='object';depth++){
  const value=current as {code?:unknown;message?:unknown;cause?:unknown};
  if(value.code)code=String(value.code);if(typeof value.message==='string')message+=' '+value.message;current=value.cause;
 }
 if(walletRequested||['transaction_reverted','approval_reverted','replacement_cancelled','user_rejected','4001','wallet_response_timeout','receipt_timeout','submission_failed'].includes(code))return publicError(error,'transaction');
 if(code==='pending_transaction'||/existing conversion|existing purchase/i.test(message))return 'An earlier purchase is still awaiting confirmation. Wait for it to finish before starting another.';
 const prefix='Your trade was not submitted. ';
 if(code==='wrong_account')return prefix+'Reconnect your wallet and try again.';
 if(code==='unsupported_chain')return prefix+'Switch your wallet to Robinhood Chain and try again.';
 if(code==='stale_quote'||/quote expired|stale quote/i.test(message))return prefix+'The quote expired. Review the refreshed quote and try again.';
 if(/Price changed|confirmed conversion minimum|updated quote/i.test(message))return prefix+'The price moved beyond your confirmed minimum. Review the updated quote and try again.';
 if(/Trade changed|form changed|Trading route changed/i.test(message))return prefix+'Your trade details changed. Review the current quote and try again.';
 if(/insufficient (funds|balance)/i.test(message))return prefix+'Your balance must cover the payment and network fee. Reduce the amount or add ETH.';
 if(code==='simulation_failed')return prefix+'The transaction check failed. Refresh the quote and try again.';
 if(/route.*unavailable|route.*not ready|Conversion unavailable/i.test(message))return prefix+'The exchange route is temporarily unavailable. Try again or pay with the paired asset.';
 if(/storage|persist/i.test(message))return prefix+'Your browser could not save purchase progress. Enable site storage and try again.';
 return prefix+'We could not complete the transaction checks. Refresh the quote and try again.';
}
