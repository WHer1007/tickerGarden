// Shared by Vite and the production static server. No credentials are written to disk.
export function securityHeaders(env={},development=false){
 const origins=new Set(["'self'",'https://api.coinbase.com','https://explorer.testnet.chain.robinhood.com','https://explorer.chain.robinhood.com']);
 for(const [key,value] of Object.entries(env))if(key.startsWith('VITE_')&&typeof value==='string'){
  try{const u=new URL(value);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password){origins.add(u.origin);if(development){const ws=new URL(u.origin);ws.protocol=u.protocol==='https:'?'wss:':'ws:';origins.add(ws.origin)}}}catch{}
 }
 if(env.VITE_SENTRY_DSN){try{const u=new URL(env.VITE_SENTRY_DSN);if(u.protocol==='https:'&&!u.password)origins.add(u.origin);}catch{}}
 if(development){origins.add('ws://127.0.0.1:*');origins.add('ws://localhost:*')}
 return {
 'Content-Security-Policy':[`default-src 'self'`,`script-src 'self'`,`style-src 'self' 'unsafe-inline'`,`img-src 'self' data: blob: https:`,`font-src 'self'`,`connect-src ${[...origins].join(' ')}`,`object-src 'none'`,`base-uri 'none'`,`frame-ancestors 'none'`,`form-action 'self'`,`frame-src 'none'`,`worker-src 'self' blob:`].join('; '),
 ...(env.VERCEL_ENV==='production'&&env.VITE_V1_CHAIN_ID==='4663'?{}:{'X-Robots-Tag':'noindex, nofollow'}),
 'X-Frame-Options':'DENY',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'strict-origin-when-cross-origin',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
 ...(development?{}:{'Strict-Transport-Security':'max-age=31536000'}),
 };
}
