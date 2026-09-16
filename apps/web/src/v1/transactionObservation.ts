import { TickerGardenV1Client, type TransactionStatusResponse } from './generated/read-api.ts';

const hash = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
const number = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
export function validateTransactionObservation(value: unknown, chainId: number, txHash: string): TransactionStatusResponse {
  const p = value as TransactionStatusResponse;
  const fail = (): never => { throw new Error('Transaction observation is inconsistent'); };
  if (!p || p.chainId !== chainId || !hash(p.transactionHash) || p.transactionHash !== txHash || p.displayOnly !== true || p.source !== 'indexed_journal_and_rpc') fail();
  if (![p.headNumber, p.finalizedNumber, p.journalHeadNumber, p.indexedFrom, p.confirmations].every(number) || ![p.headHash, p.finalizedHash, p.journalHeadHash].every(hash)) fail();
  if (BigInt(p.finalizedNumber) > BigInt(p.headNumber) || BigInt(p.journalHeadNumber) > BigInt(p.headNumber) || BigInt(p.indexedFrom) > BigInt(p.journalHeadNumber)) fail();
  if ((p.finalizedNumber === p.headNumber && p.finalizedHash !== p.headHash) || (p.journalHeadNumber === p.headNumber && p.journalHeadHash !== p.headHash)) fail();
  const canonicalHeights = new Map<string, string>();
  for (const [blockHash, height] of [[p.headHash, p.headNumber], [p.finalizedHash, p.finalizedNumber], [p.journalHeadHash, p.journalHeadNumber]] as const) {
    if (canonicalHeights.has(blockHash) && canonicalHeights.get(blockHash) !== height) fail();
    canonicalHeights.set(blockHash, height);
  }
  if (![p.journalObservedAt, p.rpcObservedAt].every(v => typeof v === 'string' && /T.*Z$/.test(v) && Number.isFinite(Date.parse(v)))) fail();
  if (!Array.isArray(p.orphanedReceipts) || p.orphanedReceipts.length > 128) fail();
  const blocks = new Set<string>();
  for (const r of [...p.orphanedReceipts, ...(p.receipt ? [p.receipt] : [])]) {
    if (!r || !number(r.blockNumber) || !number(r.transactionIndex) || !hash(r.blockHash) || !['succeeded', 'reverted'].includes(r.execution) || blocks.has(r.blockHash)) fail();
    blocks.add(r.blockHash);
  }
  if (p.orphanedReceipts.some(r => r.blockHash === p.headHash || r.blockHash === p.finalizedHash)) fail();
  if (p.receipt) {
    const r = p.receipt;
    if (canonicalHeights.has(r.blockHash) && canonicalHeights.get(r.blockHash) !== r.blockNumber) fail();
    if (BigInt(r.blockNumber) > BigInt(p.headNumber) || BigInt(p.confirmations) !== BigInt(p.headNumber) - BigInt(r.blockNumber) + 1n) fail();
    if ((r.blockNumber === p.headNumber && r.blockHash !== p.headHash) || (r.blockNumber === p.finalizedNumber && r.blockHash !== p.finalizedHash)) fail();
    if (p.state !== (BigInt(r.blockNumber) <= BigInt(p.finalizedNumber) ? 'finalized' : 'confirmed')) fail();
  } else if (p.receipt !== null || p.confirmations !== '0' || !['unknown', 'pending', 'reorged'].includes(p.state) || (p.state === 'reorged' && !p.orphanedReceipts.length) || (p.state === 'unknown' && p.orphanedReceipts.length)) fail();
  return p;
}

export function transactionObservationText(p: TransactionStatusResponse): string {
  const labels = {
    unknown: 'Not observed. This does not establish that the transaction was dropped.',
    pending: 'Pending in the RPC provider’s view.',
    confirmed: `Included, ${p.confirmations} confirmation(s).`,
    finalized: `Finalized, ${p.confirmations} confirmation(s).`,
    reorged: 'Previously included receipt was removed by a chain reorganization.',
  };
  return `Backend observation: ${labels[p.state]}${p.receipt ? ` Execution ${p.receipt.execution}.` : ''} Observed at ${p.rpcObservedAt}. Use “Check existing transaction” to verify the wallet outcome.`;
}

// Display-only: this component never modifies the executor's pending transaction.
export function mountTransactionObservation(root: HTMLElement, baseUrl: string, chainId: number, txHash: `0x${string}`): () => void {
  const button = document.createElement('button');
  button.textContent = 'Query backend status';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  root.append(button, status);
  let controller: AbortController | undefined;
  let stopped = false;
  button.onclick = async () => {
    if (stopped || controller) return;
    const current = new AbortController();
    controller = current;
    const timer = setTimeout(() => current.abort(), 10000);
    button.disabled = true;
    status.textContent = ' Querying transaction observation…';
    try {
      const client = new TickerGardenV1Client(baseUrl, (input, init) => fetch(input, { ...init, signal: current.signal, cache: 'no-store' }));
      const result = validateTransactionObservation(await client.getTransactionStatus({ txHash }), chainId, txHash);
      if (!stopped && !current.signal.aborted) status.textContent = ` ${transactionObservationText(result)}`;
    } catch {
      if (!stopped) status.textContent = ' Backend status unavailable. Use “Check existing transaction” to verify the wallet outcome.';
    } finally {
      clearTimeout(timer);
      controller = undefined;
      if (!stopped) button.disabled = false;
    }
  };
  return () => { stopped = true; controller?.abort(); button.onclick = null; status.textContent = ''; };
}
