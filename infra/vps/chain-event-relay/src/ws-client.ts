import {acquireRpcPermit} from './rpc-budget.ts';
export class WsRpcClient {
  readonly socket: WebSocket;
  readonly endpoint:string;
  readonly closedSignal = new AbortController();
  readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; method:string; started:number; requestBytes:number }>();
  closed = false;
  private nextId = 1;
  private constructor(socket: WebSocket, onLog: (value: unknown) => Promise<void>, endpoint:string) {
    this.endpoint=endpoint;
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const receivedBytes=typeof event.data==='string'?byteLength(event.data):event.data instanceof ArrayBuffer?event.data.byteLength:0;
      rpcMetric('chain_relay_ws_frame',{provider:rpcProvider(this.endpoint),receivedBytes,wsMessages:1});
      try {
        const value = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: { result?: unknown } };
        if (typeof value.id === 'number') {
          const pending = this.pending.get(value.id); if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(value.id);
          rpcMetric('chain_relay_ws_response',{method:pending.method,durationMs:Math.max(0,Math.round(performance.now()-pending.started)),requestBytes:pending.requestBytes,responseBytes:receivedBytes,outcome:value.error?'failed':'succeeded'});
          if (value.error) pending.reject(new Error('WebSocket RPC application error')); else pending.resolve(value.result);
        } else if (value.method === 'eth_subscription' && value.params?.result !== undefined) {
          rpcMetric('chain_relay_ws_notification',{deliveredBytes:receivedBytes,outcome:'received'});
          void onLog(value.params.result).then(()=>rpcMetric('chain_relay_ws_notification',{deliveredBytes:receivedBytes,outcome:'delivered'})).catch((error) => {
            console.error(JSON.stringify({ event: 'chain_relay_log_rejected', error: 'log persistence failed' }));
            socket.close(4011, 'log persistence failed');
          });
        }
      } catch { socket.close(4003, 'invalid JSON'); }
    });
    socket.addEventListener('close', () => this.markClosed());
    socket.addEventListener('error', () => this.markClosed());
  }
  static async connect(url: string, onLog: (value: unknown) => Promise<void>): Promise<WsRpcClient> {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password || endpoint.hash) throw new Error('WebSocket URL must use wss');
    const socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket open timeout')); }, 15_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket open failed')); }, { once: true });
    });
    return new WsRpcClient(socket, onLog, url);
  }
  async request<T = unknown>(method: string, params: readonly unknown[]): Promise<T> {
    const release=await acquireRpcPermit(fetch,process.env,this.endpoint,'realtime').catch(error=>{rpcMetric('chain_relay_rpc_budget_denied',{method,provider:rpcProvider(this.endpoint)});throw error;});
    try{return await this.sendRequest<T>(method,params);}finally{await release();}
  }
  private sendRequest<T>(method: string, params: readonly unknown[]): Promise<T> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('WebSocket is closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const request=JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const started=performance.now(),requestBytes=byteLength(request);
      const timer = setTimeout(() => { this.pending.delete(id);rpcMetric('chain_relay_ws_response',{method,durationMs:Math.max(0,Math.round(performance.now()-started)),requestBytes,responseBytes:0,outcome:'failed',reason:'timeout'});reject(new Error(`WebSocket ${method} timeout`)); this.close(); }, 15_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer, method, started, requestBytes });
      this.socket.send(request);rpcMetric('chain_relay_ws_request',{provider:rpcProvider(this.endpoint),method,networkCalls:1,requestBytes});
    });
  }
  close(): void { if (!this.closed) this.socket.close(); this.markClosed(); }
  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.closedSignal.abort();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer);rpcMetric('chain_relay_ws_response',{method:pending.method,durationMs:Math.max(0,Math.round(performance.now()-pending.started)),requestBytes:pending.requestBytes,responseBytes:0,outcome:'failed',reason:'disconnected'});pending.reject(new Error('WebSocket disconnected')); }
    this.pending.clear();
  }
}

function rpcProvider(url:string){const host=new URL(url).hostname;return host.endsWith('.quiknode.pro')?'quicknode':host.includes('alchemy')?'alchemy':'other';}
function rpcMetric(event:string, fields:Record<string,string|number|boolean>):void{try{console.info(JSON.stringify({event,service:'chain-event-relay',time:new Date().toISOString(),...fields}));}catch{/* telemetry must not affect relay */}}
function byteLength(text:string):number{return Buffer.byteLength(text,'utf8');}
