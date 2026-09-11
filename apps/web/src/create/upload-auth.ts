export type UploadAuthorization={nonce:string;signature:string};
export async function authorizeUpload(origin:string,body:string,account:string,chainId:number,sign:(message:string)=>Promise<string>):Promise<UploadAuthorization>{
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const response=await fetch(`${origin}/v1/content/challenges`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:account.toLowerCase(),digest}),signal:AbortSignal.timeout(10000)});
 if(response.status===429)throw Error('Upload Limit Reached. Try Later.');
 if(!response.ok)throw Error('Unable To Authorize Upload. Try Again.');
 const c=await response.json();
 const now=Math.floor(Date.now()/1000);
 if(c.account!==account.toLowerCase()||c.chainId!==chainId||c.digest!==digest||!Number.isSafeInteger(c.expires)||c.expires<=now||c.expires>now+330||typeof c.nonce!=='string'||!/^[0-9a-f]{64}$/.test(c.nonce))throw Error('Invalid Upload Authorization');
 const expected=`TickerGarden Metadata Upload\nOrigin: ${location.origin}\nChain ID: ${chainId}\nWallet: ${account.toLowerCase()}\nContent SHA-256: ${digest}\nNonce: ${c.nonce}\nExpires: ${c.expires}\nAuthorize one metadata upload. No transaction or token approval.`;
 if(c.message!==expected)throw Error('Invalid Upload Authorization');
 const signature=await sign(expected);
 if(!/^0x[0-9a-f]{130}$/i.test(signature))throw Error('Invalid Wallet Signature');
 return {nonce:c.nonce,signature};
}
