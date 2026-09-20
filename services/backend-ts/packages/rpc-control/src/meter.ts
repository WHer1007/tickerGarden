export type UsageRow={service:string;provider:string;method:string;httpRequests:number;wsRequests:number;wsMessages:number;retries:number;cacheHits:number;coalesced:number;budgetDenied:number;failed:number;requestBytes:number;responseBytes:number};
/** Counts physical calls once; logical rpc_call completion logs are not billed requests. */
export function summarizeRpcUsage(records:Record<string,unknown>[]):UsageRow[]{
 const rows=new Map<string,UsageRow>();
 for(const r of records){
  const event=r.event,physical=event==='rpc_usage'&&r.transport==='http'||event==='web_rpc_attempt'||event==='chain_relay_http_rpc';
  const wsRequest=event==='chain_relay_ws_request',wsFrame=event==='chain_relay_ws_frame';
  const reuse=typeof r.reuse==='string'?r.reuse:undefined,coalesced=event==='web_rpc_coalesced'&&r.kind!=='scope'||reuse==='coalesced';
  const denied=r.outcome==='budget_denied'||event==='web_rpc_budget_denied'||event==='chain_relay_rpc_budget_denied';
  if(!physical&&!wsRequest&&!wsFrame&&!reuse&&!coalesced&&!denied)continue;
  const service=String(r.service??'unknown'),provider=String(r.provider??'unknown'),method=wsFrame?'ws_subscription':String(r.method??'unknown'),key=JSON.stringify([service,provider,method]);
  const row=rows.get(key)??{service,provider,method,httpRequests:0,wsRequests:0,wsMessages:0,retries:0,cacheHits:0,coalesced:0,budgetDenied:0,failed:0,requestBytes:0,responseBytes:0};rows.set(key,row);
  const network=Number(r.networkCalls??(physical?1:0));
  row.httpRequests+=physical?network:0;row.wsRequests+=wsRequest?network:0;row.wsMessages+=wsFrame?Number(r.wsMessages??1):0;
  row.retries+=physical&&network&&Number(r.attempt??1)>1?1:0;
  row.cacheHits+=reuse==='shared'||reuse==='context'?1:0;row.coalesced+=coalesced?1:0;row.budgetDenied+=denied?1:0;
  row.failed+=physical&&network&&r.outcome==='failed'?1:0;
  row.requestBytes+=physical||wsRequest?Number(r.requestBytes??0):0;row.responseBytes+=physical?Number(r.responseBytes??0):wsFrame?Number(r.receivedBytes??0):0;
 }
 return [...rows.values()].sort((a,b)=>JSON.stringify([a.service,a.provider,a.method]).localeCompare(JSON.stringify([b.service,b.provider,b.method])));
}
