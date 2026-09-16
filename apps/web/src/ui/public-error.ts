/** Presentation only: never use these messages to decide transaction outcomes. */
export type PublicErrorContext = 'general' | 'recovery' | 'preview' | 'rewards' | 'transaction';
export function publicError(error: unknown, context: PublicErrorContext = 'general'): string {
  if (context === 'recovery') return 'We could not restore your previous launch. Check your wallet transaction history before starting another launch.';
  const fallback: Record<PublicErrorContext, string> = {
    recovery: '',
    preview: 'Your launch details could not be verified. Reload the page and review your choices before trying again.',
    rewards: 'Your rewards could not be verified. Reload the page to try again. Claiming will be available once your rewards can be verified.',
    transaction: 'We could not confirm the outcome of this request. Check your wallet transaction history before trying again. Do not repeat a pending transaction.',
    general: 'This information is temporarily unavailable. Please reload the page to try again.',
  };
  // Transaction errors may be raised after broadcast or during receipt verification.
  // Do not infer that funds stayed put, or that resubmission is safe, from an error.
  const transactionAdvice = context === 'transaction' ? ' Check your wallet transaction history before trying again. Do not repeat a pending transaction.' : ' Please try again.';
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const entry = current as {code?: unknown; message?: unknown; cause?: unknown};
    if (entry.code === 4001 || entry.code === '4001') return 'The wallet request was declined.' + transactionAdvice;
    current = entry.cause;
  }
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (/insufficient (?:funds|balance)/i.test(message)) return 'Your available balance may not cover the amount and network fee. Review your balance and amount.' + (context === 'transaction' ? transactionAdvice : '');
  if (/HTTP request failed|Failed to fetch|fetch failed|Network request failed|timed? out|timeout/i.test(message)) return 'The connection was interrupted.' + (context === 'transaction' ? transactionAdvice : ' Please try again shortly.');
  return fallback[context];
}
