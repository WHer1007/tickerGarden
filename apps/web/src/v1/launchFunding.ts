import { erc20Abi, parseAbi, type Address, type PublicClient } from "viem";
import { ZERO_ADDRESS } from "../runtime/model.ts";

export const NATIVE_QUOTE_SWAP_SLIPPAGE_BPS = 100n;
const BPS = 10_000n;

const v4QuoterAbi = parseAbi([
  "function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)",
]);

export type LaunchFunding = Readonly<{
  mode: "native" | "quote" | "native-fallback";
  quoteBalance: bigint;
  ethBalance: bigint;
  quotedNativeInput: bigint;
  maxNativeQuoteInput?: bigint;
}>;

export function addBpsCeil(amount: bigint, bps: bigint): bigint {
  if (amount < 0n || bps < 0n) throw new RangeError("amount and bps must be non-negative");
  return (amount * (BPS + bps) + BPS - 1n) / BPS;
}

export async function resolveLaunchFunding(input: Readonly<{
  client: PublicClient;
  account: Address;
  quoteAsset: Address;
  quoteAmount: bigint;
  quoter: Address;
  poolFee: number;
  tickSpacing: number;
}>): Promise<LaunchFunding> {
  const ethBalance = await input.client.getBalance({ address: input.account });
  if (input.quoteAsset === ZERO_ADDRESS) {
    return Object.freeze({ mode: "native", quoteBalance: 0n, ethBalance, quotedNativeInput: input.quoteAmount });
  }
  const quoteBalance = await input.client.readContract({
    abi: erc20Abi, address: input.quoteAsset, functionName: "balanceOf", args: [input.account],
  });
  if (quoteBalance >= input.quoteAmount) {
    return Object.freeze({ mode: "quote", quoteBalance, ethBalance, quotedNativeInput: 0n });
  }
  if (input.quoteAmount <= 0n || input.quoteAmount > (1n << 128n) - 1n) throw new RangeError("Developer buy is outside the v4 uint128 range");
  const simulation = await input.client.simulateContract({
    address: input.quoter,
    abi: v4QuoterAbi,
    functionName: "quoteExactOutputSingle",
    args: [{
      poolKey: { currency0: ZERO_ADDRESS, currency1: input.quoteAsset, fee: input.poolFee, tickSpacing: input.tickSpacing, hooks: ZERO_ADDRESS },
      zeroForOne: true,
      exactAmount: input.quoteAmount,
      hookData: "0x",
    }],
    account: input.account,
  });
  const result = simulation.result;
  if (!Array.isArray(result) || typeof result[0] !== "bigint" || result[0] <= 0n) throw new Error("Native-to-Quote route returned an invalid quote");
  const quotedNativeInput = result[0];
  const maxNativeQuoteInput = addBpsCeil(quotedNativeInput, NATIVE_QUOTE_SWAP_SLIPPAGE_BPS);
  return Object.freeze({ mode: "native-fallback", quoteBalance, ethBalance, quotedNativeInput, maxNativeQuoteInput });
}
