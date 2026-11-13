/** The Factory receipt is verified before requesting bounded backend registration.
 * Registration never grants arbitrary RPC access: the backend independently checks
 * the transaction, and the existing RPC target policy remains authoritative. */
export async function verifyRegisteredLaunch<T>(input:{
 verifyReceipt:()=>T;
 register:()=>Promise<boolean>;
 verifyDeployment:(created:T)=>Promise<void>;
}):Promise<T>{
 let stage:'receipt'|'registration'|'deployment'='receipt';
 try{
 const created=input.verifyReceipt();
 // A relay may already have published the market even if this notification fails.
 stage='registration';await input.register();
 stage='deployment';
 await input.verifyDeployment(created);
 return created;
 }catch(cause){throw Object.assign(new Error('Launch verification requires recovery',{cause}),{name:'LaunchVerificationError',verificationStep:stage});}
}
