const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface CursorContext { readonly scope: string; readonly filter: string; readonly snapshot: string }
export interface PageRequest extends CursorContext { readonly limit: number; readonly after: string | null }

interface CursorPayload extends CursorContext { readonly version: 1; readonly after: string }

export function parsePageRequest(searchParams: URLSearchParams, context: CursorContext): PageRequest {
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  const rawCursor = searchParams.get("cursor");
  if (rawCursor === null) return { ...context, limit, after: null };
  try {
    const decoded = Buffer.from(rawCursor, "base64url").toString("utf8");
    if (decoded.length === 0 || Buffer.from(decoded, "utf8").toString("base64url") !== rawCursor) throw new Error();
    const payload: unknown = JSON.parse(decoded);
    if (
      typeof payload !== "object" || payload === null || !("version" in payload) || payload.version !== 1 ||
      !("scope" in payload) || payload.scope !== context.scope || !("filter" in payload) || payload.filter !== context.filter ||
      !("snapshot" in payload) || payload.snapshot !== context.snapshot || !("after" in payload) || typeof payload.after !== "string"
    ) throw new Error();
    return { ...context, limit, after: payload.after };
  } catch {
    throw new Error("cursor is malformed or belongs to a different query snapshot");
  }
}

export function paginate<T>(items: readonly T[], request: PageRequest, identity: (item: T) => string): { readonly items: readonly T[]; readonly nextCursor: string | null } {
  const ordered = [...items].sort((left, right) => {
    const leftId = identity(left).toLowerCase();
    const rightId = identity(right).toLowerCase();
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  const start = request.after === null ? 0 : ordered.findIndex((item) => identity(item).toLowerCase() > request.after!);
  if (start < 0) return { items: [], nextCursor: null };
  const page = ordered.slice(start, start + request.limit);
  const hasMore = start + request.limit < ordered.length;
  const last = page.at(-1);
  const payload: CursorPayload | null = hasMore && last ? {
    version: 1, scope: request.scope, filter: request.filter, snapshot: request.snapshot, after: identity(last).toLowerCase(),
  } : null;
  return { items: page, nextCursor: payload ? Buffer.from(JSON.stringify(payload), "utf8").toString("base64url") : null };
}
