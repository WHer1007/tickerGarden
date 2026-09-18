import {randomUUID} from 'node:crypto';
import {safeError,safeContext} from '../../../services/backend-ts/packages/observability/src/sanitize.ts';
export function webRequestId(){return randomUUID();}
/** Serverless Web functions do not load the browser SDK; Vercel retains these structured events. */
export function reportWebError(event:string,error:unknown,fields:Record<string,unknown>){
 try{console.error(JSON.stringify({timestamp:new Date().toISOString(),level:'error',service:'web-api',environment:process.env.TG_ENVIRONMENT??process.env.VERCEL_ENV??'local',releaseCommit:process.env.TG_RELEASE_COMMIT??process.env.VERCEL_GIT_COMMIT_SHA??'unconfigured',...safeContext({event,...fields}),error:safeError(error)}));}catch{}
}
