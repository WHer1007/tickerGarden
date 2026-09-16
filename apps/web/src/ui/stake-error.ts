import {keccak256,toHex} from 'viem';
const deficitSelector=keccak256(toHex('StockPrincipalDeficit(bytes32,uint256,uint256)')).slice(0,10);
export function stakeErrorMessage(message:string,pending:boolean):string {
  if(pending)return 'Confirmation pending. Check your wallet.';
  if(/reject|denied|cancel/i.test(message))return 'Transaction cancelled.';
  if(/StockPrincipalDeficit/.test(message)||message.toLowerCase().includes(deficitSelector))return 'This Stock Vault has a principal shortfall. New deposits are blocked until the shortfall is resolved.';
  return 'Unable to stake. Please try again.';
}
