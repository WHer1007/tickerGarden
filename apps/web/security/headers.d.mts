export function securityHeaders(env?:Record<string,unknown>,development?:boolean):{
 'Content-Security-Policy':string;
 'X-Robots-Tag'?:string;
 'X-Frame-Options':string;
 'X-Content-Type-Options':string;
 'Referrer-Policy':string;
 'Permissions-Policy':string;
 'Strict-Transport-Security'?:string;
};
