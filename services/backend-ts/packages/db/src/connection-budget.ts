export type ConnectionBudgetService = {
  name: string;
  instances: number;
  poolMax: number;
  rollingInstances?: number;
  extraConnections?: number;
};

export type ConnectionBudgetInput = {
  maxConnections: number;
  reservedConnections: number;
  services: ConnectionBudgetService[];
};

export type ConnectionBudget = {
  used: number;
  available: number;
  headroom: number;
};

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const requireCount = (value: unknown, label: string): number => {
  if (!isSafeNonNegativeInteger(value)) throw new Error(`${label} must be a safe non-negative integer`);
  return value;
};

export function evaluateConnectionBudget(input: ConnectionBudgetInput): ConnectionBudget {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  const max = requireCount(input.maxConnections, 'maxConnections');
  const reserved = requireCount(input.reservedConnections, 'reservedConnections');
  if (!Array.isArray(input.services)) throw new Error('services must be an array');
  if (reserved > max) throw new Error('reservedConnections cannot exceed maxConnections');

  const names = new Set<string>();
  let used = 0n;
  for (const service of input.services) {
    if (!service || typeof service !== 'object' || typeof service.name !== 'string' || service.name.length === 0) {
      throw new Error('service name must be a non-empty string');
    }
    if (names.has(service.name)) throw new Error(`duplicate service name: ${service.name}`);
    names.add(service.name);
    const instances = requireCount(service.instances, `${service.name}.instances`);
    const poolMax = requireCount(service.poolMax, `${service.name}.poolMax`);
    const extra = requireCount(service.extraConnections ?? 0, `${service.name}.extraConnections`);
    if (instances < 1 || poolMax < 1) throw new Error(`${service.name} instances and poolMax must be at least 1`);
    const rolling = requireCount(service.rollingInstances ?? 0, `${service.name}.rollingInstances`);
    used += (BigInt(instances) + BigInt(rolling)) * (BigInt(poolMax) + BigInt(extra));
  }
  const available = BigInt(max - reserved);
  if (used > available) throw new Error(`connection budget exceeded: used ${used}, available ${available}`);
  return { used: Number(used), available: Number(available), headroom: Number(available - used) };
}

export function validateDatabasePlacement(input: {
  applicationRegion: string;
  databaseRegion: string;
  workerRegion: string;
}): true {
  if (!input || typeof input !== 'object') throw new Error('placement must be an object');
  const normalize = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be an explicit region`);
    if (value === 'sin1' || value === 'ap-southeast-1' || value === 'singapore') return 'sin1';
    throw new Error(`unknown ${label}: ${value}`);
  };
  if (normalize(input.applicationRegion, 'applicationRegion') !== 'sin1' ||
      normalize(input.databaseRegion, 'databaseRegion') !== 'sin1' ||
      normalize(input.workerRegion, 'workerRegion') !== 'sin1') throw new Error('all regions must be sin1');
  return true;
}

// Shared database roles must receive the sum of every service using that role.
export function connectionRoleLimitsSql(input:ConnectionBudgetInput, roles:Readonly<Record<string,string>>):string {
  evaluateConnectionBudget(input);
  const totals=new Map<string,number>();
  for(const service of input.services){
    const role=roles[service.name];
    if(!role||!/^[a-z][a-z0-9_]{0,62}$/.test(role))throw Error(`missing or invalid database role for ${service.name}`);
    totals.set(role,(totals.get(role)??0)+(service.instances+(service.rollingInstances??0))*(service.poolMax+(service.extraConnections??0)));
  }
  return [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([role,limit])=>`ALTER ROLE "${role}" CONNECTION LIMIT ${limit};`).join('\n');
}
