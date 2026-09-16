import type {PurchaseQuote} from '../create/quote-purchase.ts';
import { erc20Abi, type Address, type PublicClient } from "viem";
import { ZERO_ADDRESS } from "../runtime/model.ts";

export type LaunchFunding = Readonly<{
  mode: "native" | "quote";
  purchase?: PurchaseQuote;
  quoteBalance: bigint | null;
  ethBalance: bigint;
  quotedNativeInput: bigint;
}>;

export async function resolveLaunchFunding(input: Readonly<{
  client: PublicClient;
  account: Address;
  quoteAsset: Address;
  quoteAmount: bigint;
  quotePurchase?: (shortfall: bigint) => Promise<PurchaseQuote>;
}>): Promise<LaunchFunding> {
  if (input.quoteAmount < 0n || input.quoteAmount > (1n << 256n) - 1n) throw new RangeError("Invalid first-buy amount");
  const ethBalance = await input.client.getBalance({ address: input.account });
  if (input.quoteAsset === ZERO_ADDRESS) {
    return Object.freeze({ mode: "native", quoteBalance: 0n, ethBalance, quotedNativeInput: input.quoteAmount });
  }
  if (input.quoteAmount === 0n) return Object.freeze({ mode: "quote", quoteBalance: null, ethBalance, quotedNativeInput: 0n });
  const quoteBalance = await input.client.readContract({
    abi: erc20Abi, address: input.quoteAsset, functionName: "balanceOf", args: [input.account],
  });
  if (quoteBalance < input.quoteAmount) {
    if(!input.quotePurchase)throw new Error("Insufficient paired asset balance. Acquire the selected asset before creating with a developer buy.");
    const purchase=await input.quotePurchase(input.quoteAmount-quoteBalance);
    return Object.freeze({mode:'quote',quoteBalance,ethBalance,quotedNativeInput:BigInt(purchase.amountIn),purchase});
  }
  return Object.freeze({ mode: "quote", quoteBalance, ethBalance, quotedNativeInput: 0n });
}
