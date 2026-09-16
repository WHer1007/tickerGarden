const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const UINT256_MAX = (1n << 256n) - 1n;

export function address(value: string): `0x${string}` {
  if (!ADDRESS.test(value)) throw new TypeError('address must be lowercase 20-byte hex');
  return value as `0x${string}`;
}

export function hash32(value: string): `0x${string}` {
  if (!HASH.test(value)) throw new TypeError('hash must be lowercase 32-byte hex');
  return value as `0x${string}`;
}

export function uint256(value: string | bigint): string {
  const raw = typeof value === 'bigint' ? value.toString() : value;
  if (!UINT.test(raw)) throw new TypeError('uint256 must be an unsigned canonical decimal string');
  const parsed = BigInt(raw);
  if (parsed > UINT256_MAX) throw new RangeError('uint256 exceeds 256 bits');
  return raw;
}

export function chainId(value: number): 4663 | 46630 {
  if (value !== 4663 && value !== 46630) throw new RangeError('unsupported chain ID');
  return value;
}

export function isoTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('timestamp must be a UTC ISO-8601 value');
  }
  return value;
}
