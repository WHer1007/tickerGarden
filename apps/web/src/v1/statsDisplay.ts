export type StatsSection = 'overview' | 'allocations' | 'stocks';
export type StatsOverview = {
  volumeUsd: string | null;
  feeRevenueUsd: string | null;
  launches24h: number | null;
  bloomedMarkets: number;
  stakingValueUsd: string | null;
  stakingWallets: number | null;
};
export type StatsAllocations = { creator: string | null; staker: string | null; holder: string | null; platform: string | null };
export type StatsStock = { id: string; token: string; label: string; name?: string; decimals: number; amountRaw: string; valueUsd: string | null };
export type StatsDisplaySections = { overview?: StatsOverview; allocations?: StatsAllocations; stocks?: StatsStock[] };
export type StatsDisplay = { schemaVersion: 4; chainId: number; displayOnly: true; revision: string; sections: StatsDisplaySections };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const usd = (value: unknown): value is string | null => value === null || (typeof value === 'string' && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value));

export function parseStatsDisplay(raw: unknown, chainId: number): StatsDisplay {
  if (!record(raw) || raw.schemaVersion !== 4 || raw.chainId !== chainId || raw.displayOnly !== true || typeof raw.revision !== 'string' || !raw.revision || !record(raw.sections)) throw Error('Invalid Stats display snapshot');
  const sections = raw.sections as Record<string, unknown>;
  if (Object.keys(sections).some(key => !['overview', 'allocations', 'stocks'].includes(key))) throw Error('Invalid Stats display sections');
  const parsed: StatsDisplaySections = {};
  if ('overview' in sections) {
    const value = sections.overview;
    if (!record(value) || !usd(value.volumeUsd) || !usd(value.feeRevenueUsd) || !(value.launches24h === null || count(value.launches24h)) || !count(value.bloomedMarkets) || !usd(value.stakingValueUsd) || !(value.stakingWallets === null || count(value.stakingWallets))) throw Error('Invalid Stats overview');
    parsed.overview = value as StatsOverview;
  }
  if ('allocations' in sections) {
    const value = sections.allocations;
    if (!record(value) || !['creator', 'staker', 'holder', 'platform'].every(key => usd(value[key])) || Object.keys(value).some(key => !['creator', 'staker', 'holder', 'platform'].includes(key))) throw Error('Invalid Stats allocations');
    parsed.allocations = value as StatsAllocations;
  }
  if ('stocks' in sections) {
    const value = sections.stocks;
    if (!Array.isArray(value) || value.some(row => !record(row) || typeof row.id !== 'string' || !row.id || typeof row.token !== 'string' || !row.token || typeof row.label !== 'string' || !row.label || (row.name !== undefined && typeof row.name !== 'string') || !count(row.decimals) || row.decimals > 255 || typeof row.amountRaw !== 'string' || !/^(0|[1-9][0-9]*)$/.test(row.amountRaw) || !usd(row.valueUsd))) throw Error('Invalid Stats stocks');
    const ids = new Set<string>();
    for (const row of value as StatsStock[]) { if (ids.has(row.id)) throw Error('Duplicate Stats Stock'); ids.add(row.id); }
    parsed.stocks = value as StatsStock[];
  }
  if (!Object.keys(sections).length) throw Error('Empty Stats display snapshot');
  return { schemaVersion: 4, chainId, displayOnly: true, revision: raw.revision, sections: parsed };
}

/** Keeps the last known section when a response omits it or a refresh fails. */
export class StatsDisplayStore {
  private value: StatsDisplay = { schemaVersion: 4, chainId: 0, displayOnly: true, revision: '', sections: {} };
  private readonly chainId: number;
  constructor(chainId: number) { this.chainId = chainId; this.value.chainId = chainId; }
  get snapshot(): StatsDisplay { return this.value; }
  apply(raw: unknown, requested?: StatsSection): StatsDisplay {
    const next = parseStatsDisplay(raw, this.chainId);
    if (requested && !(requested in next.sections)) throw Error('Missing requested Stats section');
    const sections = { ...this.value.sections };
    const keys = requested ? [requested] : Object.keys(next.sections) as StatsSection[];
    for (const key of keys) if (key in next.sections) Object.assign(sections, { [key]: next.sections[key] });
    this.value = { ...this.value, revision: next.revision, sections };
    return this.value;
  }
}
