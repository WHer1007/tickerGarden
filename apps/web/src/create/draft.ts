/** Small, versioned create-form draft. Never stores files, wallet data, or transaction state. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CreateDraft {
  version: 1;
  chainId: number;
  name?: string;
  symbol?: string;
  description?: string;
  x?: string;
  website?: string;
  firstBuyAmount?: string;
  creatorTax?: string;
  burnMemeFees?: boolean;
  lpFeeEnabled?: boolean;
  lpFeePips?: string;
  quoteAssetConfigId?: string;
  assetUid?: string;
  tickerGardenBaselineId?: string;
  launchTemplateId?: string;
  launchMode?: string;
  stakingEnabled?: boolean;
  treasuryEnabled?: boolean;
  hadImage: boolean;
}

const VERSION = 1 as const;
const MAX_BYTES = 16 * 1024;
const TEXT_FIELDS = ["name", "symbol", "description", "x", "website", "firstBuyAmount", "creatorTax", "lpFeePips",
  "quoteAssetConfigId", "assetUid", "tickerGardenBaselineId", "launchTemplateId", "launchMode"] as const;
const BOOL_FIELDS = ["stakingEnabled", "treasuryEnabled", "burnMemeFees", "lpFeeEnabled"] as const;
type TextField = typeof TEXT_FIELDS[number];
type BoolField = typeof BOOL_FIELDS[number];

export type CreateDraftInput = Partial<Pick<CreateDraft, TextField | BoolField>> & { hadImage?: boolean };

export function createDraftKey(chainId: number): string {
  return `tickergarden:create-draft:v${VERSION}:${chainId}`;
}

function validChainId(chainId: number): boolean { return Number.isSafeInteger(chainId) && chainId > 0; }

export function readCreateDraft(storage: DraftStorage, chainId: number): CreateDraft | null {
  if (!validChainId(chainId)) return null;
  let raw: string | null;
  try { raw = storage.getItem(createDraftKey(chainId)); } catch { return null; }
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  if (source.version !== VERSION || source.chainId !== chainId || typeof source.hadImage !== "boolean") return null;
  const draft: CreateDraft = { version: VERSION, chainId, hadImage: source.hadImage };
  for (const field of TEXT_FIELDS) if (typeof source[field] === "string") draft[field] = source[field] as string;
  for (const field of BOOL_FIELDS) if (typeof source[field] === "boolean") draft[field] = source[field] as boolean;
  return draft;
}

export function writeCreateDraft(storage: DraftStorage, chainId: number, input: CreateDraftInput): boolean {
  if (!validChainId(chainId)) return false;
  const draft: CreateDraft = { version: VERSION, chainId, hadImage: input.hadImage === true };
  for (const field of TEXT_FIELDS) if (typeof input[field] === "string") draft[field] = input[field];
  for (const field of BOOL_FIELDS) if (typeof input[field] === "boolean") draft[field] = input[field];
  try {
    const value = JSON.stringify(draft);
    if (new TextEncoder().encode(value).byteLength > MAX_BYTES) return false;
    storage.setItem(createDraftKey(chainId), value);
    return true;
  } catch { return false; }
}

export function clearCreateDraft(storage: DraftStorage, chainId: number): void {
  if (!validChainId(chainId)) return;
  try { storage.removeItem(createDraftKey(chainId)); } catch { /* Storage is optional. */ }
}
