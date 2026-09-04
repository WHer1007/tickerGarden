import type { Address, Hex } from "viem";
import { v1Abis } from "../generated/abis.ts";
import { createContractWriteRequest, type ContractWriteRequest } from "../transaction.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX32 = /^0x[0-9a-f]{64}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function address(value: Address, label: string): void {
  if (!ADDRESS.test(value) || value === ZERO_ADDRESS) throw new TypeError(`${label} must be a lowercase non-zero address`);
}

function marketId(value: Hex): void {
  if (!HEX32.test(value)) throw new TypeError("marketId must be canonical lowercase bytes32");
}

export function buildClaimCreator(input: Readonly<{
  feeVault: Address;
  marketId: Hex;
  epoch: number;
  asset: Address;
}>): ContractWriteRequest {
  address(input.feeVault, "feeVault");
  marketId(input.marketId);
  if (!Number.isSafeInteger(input.epoch) || input.epoch <= 0 || input.epoch > 0xffff_ffff) {
    throw new RangeError("creator epoch must be a positive uint32");
  }
  if (!ADDRESS.test(input.asset)) throw new TypeError("asset must be a lowercase address");
  return createContractWriteRequest({
    abi: v1Abis.ProtocolFeeVault,
    address: input.feeVault,
    functionName: "claimCreator",
    args: [input.marketId, input.epoch, input.asset],
  });
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
