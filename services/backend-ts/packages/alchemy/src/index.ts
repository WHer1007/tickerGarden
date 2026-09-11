import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE = {
  id: 'alchemy-evm-standard-json-rpc-2026-09-11',
  asOf: '2026-09-11',
  source: 'https://www.alchemy.com/docs/reference/compute-unit-costs',
  methods: {
    eth_chainId: 0,
    eth_getBlockByNumber: 20,
    eth_getLogs: 60,
    eth_getTransactionReceipt: 20,
    eth_getTransactionByHash: 20,
    eth_call: 26,
    eth_getCode: 20,
  },
} as const;

export type AlchemyMeteredMethod = keyof typeof ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE.methods;

export function alchemyNominalComputeUnits(method: string): number | null {
  return Object.hasOwn(ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE.methods, method)
    ? ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE.methods[method as AlchemyMeteredMethod]
    : null;
}

const AlchemyWebhookEnvelope = z.object({
  webhookId: z.string().regex(/^wh_[A-Za-z0-9]+$/).max(160),
  id: z.string().regex(/^whevt_[A-Za-z0-9]+$/).max(160),
  createdAt: z.string().datetime({ offset: true }),
  type: z.literal('GRAPHQL'),
  event: z.record(z.string(), z.unknown()),
}).strict();

const AlchemyWebhookCreationResponse = z.object({
  data: z.object({
    id: z.string().regex(/^wh_[A-Za-z0-9]+$/).max(160),
    version: z.string().min(1).max(160),
    is_active: z.boolean(),
    signing_key: z.string().min(1).max(512),
  }).passthrough(),
}).passthrough();

export type AlchemyWebhook = z.infer<typeof AlchemyWebhookEnvelope>;
export type CreatedAlchemyWebhook = Readonly<{ webhookId: string; version: string; signingKey: string; active: boolean }>;

export function parseAlchemyWebhookCreationResponse(value: unknown): CreatedAlchemyWebhook {
  const parsed = AlchemyWebhookCreationResponse.parse(value).data;
  return Object.freeze({ webhookId: parsed.id, version: parsed.version, signingKey: parsed.signing_key, active: parsed.is_active });
}

export function updateAlchemyRuntimeSecrets(source: string, created: CreatedAlchemyWebhook): string {
  if (created.active) throw new Error('Alchemy webhook must be inactive before storing runtime secrets');
  const updates = {
    TG_ALCHEMY_WEBHOOK_ID: created.webhookId,
    TG_ALCHEMY_WEBHOOK_SIGNING_KEY: created.signingKey,
  } as const;
  let output = source;
  for (const [key, value] of Object.entries(updates)) {
    if (/\r|\n/.test(value)) throw new Error(`Invalid ${key}`);
    const pattern = new RegExp(`^${key}=.*$`, 'gm');
    const matches = [...output.matchAll(pattern)];
    if (matches.length > 1) throw new Error(`Duplicate ${key} in environment file`);
    const line = `${key}=${JSON.stringify(value)}`;
    output = matches.length === 1 ? output.replace(pattern, line) : `${output}${output.endsWith('\n') || output.length === 0 ? '' : '\n'}${line}\n`;
  }
  return output;
}

const BlockTriggerData = z.object({
  data: z.object({
    block: z.object({ hash: z.string().regex(/^0x[0-9a-f]{64}$/), number: z.union([z.number().int().nonnegative(), z.string().regex(/^[0-9]+$/)]) }).strict(),
  }).strict(),
  sequenceNumber: z.union([z.string(), z.number()]).optional(),
}).passthrough();

export interface AlchemyBlockTrigger {
  readonly number: bigint;
  readonly hash: `0x${string}`;
}

export function verifyAlchemySignature(rawBody: string, signature: string | undefined, signingKey: string): boolean {
  if (!signingKey || !signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', signingKey).update(rawBody, 'utf8').digest('hex');
  const left = Buffer.from(signature, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function parseAlchemyWebhook(rawBody: string, expectedWebhookId: string): AlchemyWebhook {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new TypeError('Alchemy webhook body must be JSON');
  }
  const envelope = AlchemyWebhookEnvelope.parse(value);
  if (!expectedWebhookId || envelope.webhookId !== expectedWebhookId) throw new TypeError('Alchemy webhook ID is not trusted');
  return envelope;
}

export function parseAlchemyBlockTrigger(webhook: AlchemyWebhook): AlchemyBlockTrigger {
  const parsed = BlockTriggerData.parse(webhook.event);
  const number = BigInt(parsed.data.block.number);
  return { number, hash: parsed.data.block.hash as `0x${string}` };
}
