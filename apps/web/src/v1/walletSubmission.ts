/** Ending the UI attempt cannot cancel an outstanding wallet request. Observe late results separately. */
export function waitForWalletSubmission<T>(request:Promise<T>,onLateResult:(value:T)=>void,timeoutMs=20000):Promise<T>{
 return new Promise((resolve,reject)=>{
  let expired=false;
  const timer=setTimeout(()=>{expired=true;reject(Object.assign(new Error('Wallet submission response deadline exceeded'),{code:'wallet_response_timeout'}));},timeoutMs);
  request.then(value=>{
   clearTimeout(timer);
   if(expired){try{onLateResult(value);}catch{/* Late response must never restart the expired operation. */}}
   else resolve(value);
  },error=>{clearTimeout(timer);if(!expired)reject(error);});
 });
}
