import type { PageName } from '../routing/routes.ts';

/** Keeps transaction recovery controls on the page that initiated the operation. */
export function pendingTransactionPage(operationKey: string | undefined): PageName | null {
  if (!operationKey) return null;
  if (operationKey.startsWith('trade:') || operationKey.startsWith('pool-approval:') || operationKey.startsWith('pool-trade:')) return 'trade';
  if (operationKey.startsWith('launch:') || operationKey.startsWith('approval:')) return 'create';
  if (/^reward:(stake|unstakeAndWithdraw|rageQuit|direct-vault-rage-quit):/.test(operationKey)) return 'staking';
  if (operationKey.startsWith('reward:')) return 'rewards';
  return null;
}
