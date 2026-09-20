export type WsHeartbeatOptions = {
  request(): Promise<unknown>;
  close(): void;
  intervalMs?: number;
  timeoutMs?: number;
};

/** Periodically prove the RPC socket is responsive, without adding a subscription. */
export function startWsHeartbeat({ request, close, intervalMs = 30_000, timeoutMs = 10_000 }: WsHeartbeatOptions): () => void {
  let stopped = false;
  let inFlight = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    let settled = false;
    timeout = setTimeout(() => {
      if (settled || stopped) return;
      settled = true;
      inFlight = false;
      stopped = true;
      clearInterval(timer);
      close();
    }, timeoutMs);
    void request().then(() => {
      if (settled || stopped) return;
      settled = true;
      clearTimeout(timeout);
      inFlight = false;
    }, (error:unknown) => {
      if (settled || stopped) return;
      settled = true;
      clearTimeout(timeout);
      inFlight = false;
      // Local admission is not evidence of a broken provider connection.
      if((error as {name?:string})?.name==='RpcBudgetBusy')return;
      stopped = true;
      clearInterval(timer);
      close();
    });
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    if (timeout) clearTimeout(timeout);
  };
}
