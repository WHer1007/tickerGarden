/** Explicit operator entry point. Never invoked by user-facing requests. */
import {drainAlerts} from '../packages/observability/src/lark.ts';
import {logEvent,reportError} from '../packages/observability/src/index.ts';
async function main(){
 if(process.argv[2]!=='--send')throw Error('Explicit --send is required');
 const dir=process.env.TG_ALERT_SPOOL_DIR,url=process.env.TG_LARK_WEBHOOK_URL,secret=process.env.TG_LARK_SIGNING_SECRET;
 if(!dir?.startsWith('/')||!url||!secret)throw Error('Alert spool and Lark configuration are required');
 const result=await drainAlerts(dir,{webhookUrl:url,signingSecret:secret});
 logEvent('alert-delivery',result.dead?'error':result.retry?'warn':'info','alert_delivery',result);
 if(result.dead)process.exitCode=1;
}
main().catch(error=>{reportError('alert-delivery','alert_delivery_failed',error);process.exitCode=1;});
