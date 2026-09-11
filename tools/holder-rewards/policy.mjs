export const DUAL_MODE='0x458d54500696dc39b16c6ab10d3d910a7a417254f23c706ae72d75037d8fd0fc';
export const supportedMode=mode=>mode===DUAL_MODE;
export function requireCurrentOperation(operation){
 if(!['sweep','fund','fund-meme','checkpoint'].includes(operation))throw Error('Unsupported persisted operation; reconcile its receipt before using this worker');
}
export const DEFAULT_INTERVAL_SECONDS=4*60*60;
export function configuredInterval(value=String(DEFAULT_INTERVAL_SECONDS)) {
 if(!/^\d+$/.test(value)||Number(value)<3600||Number(value)>86400)throw Error('Holder interval must be 3600..86400 seconds');
 return Number(value);
}
export function restartDelay(lastTickAt,now,intervalSeconds=DEFAULT_INTERVAL_SECONDS) {
 if(!lastTickAt)return 0;
 const last=Date.parse(lastTickAt);if(!Number.isFinite(last))throw Error('Invalid persisted check time');
 return Math.min(intervalSeconds*1000,Math.max(0,last+intervalSeconds*1000-now));
}
// Candidate data is a scheduling hint only. All money and identities come from RPC.
export function due(item, previous, now) {
 if(!/^0x[0-9a-f]{64}$/.test(item.marketId)||!/^0x[0-9a-f]{40}$/.test(item.token)||!/^\d+$/.test(item.revision))throw Error('Invalid candidate');
 if(previous&&now<previous.nextAt)return false;
 return !previous||previous.retry||previous.revision!==item.revision;
}
export function fundingDecision({amount,minimum,mode=DUAL_MODE}) {
 if(!supportedMode(mode))throw Error('Unsupported distributor');
 if(minimum<=0n)throw Error('Missing positive asset minimum');
 return amount<minimum?'dust':'fund';
}
export function streamCheckpointDue({mode,idle,supply,nextStart,now}) {
 if(!supportedMode(mode))throw Error('Unsupported distributor');
 return idle>0n&&supply>0n&&now>=nextStart;
}
