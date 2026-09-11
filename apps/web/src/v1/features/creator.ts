import type { Address, Hex } from "viem";
import { v1Abis } from "../generated/abis.ts";
import { createContractWriteRequest, type ContractWriteRequest } from "../transaction.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function address(value: Address, label: string): void {
  if (!ADDRESS.test(value) || value === ZERO_ADDRESS) throw new TypeError(`${label} must be a lowercase non-zero address`);
}

function marketId(value: Hex): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) throw new TypeError("marketId must be canonical lowercase bytes32");
}

export function buildTransferCreatorBeneficiary(input: Readonly<{
  registry: Address;
  marketId: Hex;
  nextBeneficiary: Address;
}>): ContractWriteRequest {
  address(input.registry, "creatorRevenueRegistry");
  marketId(input.marketId);
  address(input.nextBeneficiary, "nextBeneficiary");
  return createContractWriteRequest({
    abi: v1Abis.CreatorRevenueRegistry,
    address: input.registry,
    functionName: "transferCreatorRevenueBeneficiary",
    args: [input.marketId, input.nextBeneficiary],
  });
}
