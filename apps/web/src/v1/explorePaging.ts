export type ExplorePage<T> = {
  items: readonly T[];
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  availablePages: number;
  recovered?: boolean;
};

type StoredPage<T> = {
  items: readonly T[];
  nextCursor: string | null;
};

export function createExplorePager<T extends { marketId: string }>(
  pageSize: number,
  fetchPage: (
    query: any,
    cursor: string | undefined,
    limit: number,
    signal: AbortSignal,
  ) => Promise<{ items: readonly T[]; nextCursor: string | null }>,
) {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("pageSize must be a positive integer");
  }

  let queryKey: string | undefined;
  let queryValue: object | undefined;
  let pages = new Map<number, StoredPage<T>>();
  let currentPage = 0;
  let generation = 0;
  let controller: AbortController | undefined;
  let inFlight: Promise<ExplorePage<T> | null> | undefined;

  const result = (page: number, stored: StoredPage<T>, recovered = false): ExplorePage<T> => ({
    items: stored.items,
    page,
    hasPrevious: page > 1,
    hasNext: stored.nextCursor !== null,
    availablePages: Math.max(...pages.keys()) + (pages.get(Math.max(...pages.keys()))?.nextCursor ? 1 : 0),
    ...(recovered ? { recovered: true } : {}),
  });

  const pause = () => {
    controller?.abort();
    controller = undefined;
    inFlight = undefined;
    generation += 1;
  };

  const resetState = () => {
    pause();
    pages = new Map();
    currentPage = 0;
  };

  const validate = (items: readonly T[], nextCursor: string | null) => {
    if(!Array.isArray(items))throw new Error("invalid items");
    if (items.length > pageSize) throw new Error("fetch returned more items than pageSize");
    if (nextCursor !== null && (typeof nextCursor !== "string" || nextCursor.length === 0 || nextCursor.length>8192)) {
      throw new Error("invalid next cursor");
    }
    if (items.length === 0 && nextCursor !== null) {
      throw new Error("empty page cannot have a next cursor");
    }
    const ids = new Set<string>();
    for (const item of items) {
      if (typeof item?.marketId !== "string" || ids.has(item.marketId)) {
        throw new Error("duplicate or invalid marketId");
      }
      ids.add(item.marketId);
    }
    for (const page of pages.values()) {
      for (const item of page.items) {
        if (ids.has(item.marketId)) throw new Error("duplicate marketId across pages");
      }
    }
  };

  const load = async (
    query: object,
    direction: "current" | "next" | "previous" | number = "current",
  ): Promise<ExplorePage<T> | null> => {
    const suppliedQuery = query;
    // Cursor pages belong to a pinned publication. A background revision must
    // not jump the reader back to page 1 or combine old cursors with new data.
    const filters=(value:object)=>{const {revision:_,...rest}=value as Record<string,unknown>;return JSON.stringify(rest);};
    if(queryValue&&(currentPage>1||inFlight||(direction!=='current'&&currentPage>0))&&filters(queryValue)===filters(query))query=queryValue;
    const nextKey = JSON.stringify(query);
    if (queryKey !== nextKey) {
      resetState();
      queryKey = nextKey;
      queryValue = query;
    }
    if (inFlight) return inFlight;

    if (typeof direction === "number" && (!Number.isSafeInteger(direction) || direction < 1)) {
      throw new Error("invalid page number");
    }
    const target = typeof direction === "number" ? direction : direction === "previous"
      ? Math.max(1, currentPage - 1)
      : direction === "next"
        ? currentPage + 1
        : currentPage || 1;
    if (direction === "previous" && currentPage <= 1) return null;
    const cached = pages.get(target);
    if (cached) {
      currentPage = target;
      return result(target, cached);
    }
    if (direction === "previous") return null;
    const cursor = target === 1 ? undefined : pages.get(target - 1)?.nextCursor ?? undefined;
    if (target > 1 && !cursor) throw new Error("missing cursor for requested page");
    let seenCursors = new Set<string>();
    for (const page of pages.values()) if (page.nextCursor !== null) seenCursors.add(page.nextCursor);
    const localGeneration = generation;
    const localController = new AbortController();
    controller = localController;
    const timer=setTimeout(()=>localController.abort(),10000);
    const isConflict = (error: unknown) => {
      const value = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
      return value?.status === 409 || value?.statusCode === 409 || value?.response?.status === 409;
    };
    const savedPages = pages;
    const savedCurrentPage = currentPage;
    const savedQueryKey = queryKey;
    const savedQueryValue = queryValue;
    const restoreSavedState = () => {
      if (localGeneration !== generation) return;
      pages = savedPages;
      currentPage = savedCurrentPage;
      queryKey = savedQueryKey;
      queryValue = savedQueryValue;
    };
    const request = (async () => {
      let response: { items: readonly T[]; nextCursor: string | null };
      let responsePage = target;
      let responseCursor = cursor;
      let recovered = false;
      try {
        response = await fetchPage(queryValue, responseCursor, pageSize, localController.signal);
      } catch (error) {
        if (!isConflict(error) || localGeneration !== generation) throw error;
        pages = new Map();
        currentPage = 0;
        seenCursors = new Set();
        queryValue = suppliedQuery;
        queryKey = JSON.stringify(suppliedQuery);
        responsePage = 1;
        responseCursor = undefined;
        recovered = true;
        try {
          response = await fetchPage(suppliedQuery, responseCursor, pageSize, localController.signal);
        } catch (recoveryError) {
          restoreSavedState();
          throw recoveryError;
        }
      }
      if (localGeneration !== generation) return null;
      if(localController.signal.aborted){if(recovered)restoreSavedState();throw new Error("Directory query timed out");}
      try {
        validate(response.items, response.nextCursor);
        if (response.nextCursor !== null && seenCursors.has(response.nextCursor)) {
          throw new Error("repeated cursor");
        }
      } catch (validationError) {
        if (recovered) restoreSavedState();
        throw validationError;
      }
      const stored = { items: response.items, nextCursor: response.nextCursor };
      pages.set(responsePage, stored);
      currentPage = responsePage;
      return result(responsePage, stored, recovered);
    })()
      .catch(error=>{if(localGeneration!==generation)return null;throw error;})
      .finally(() => {
        clearTimeout(timer);
        if (controller === localController) {
          controller = undefined;
          inFlight = undefined;
        }
      });
    inFlight = request;
    return request;
  };

  const reset = () => {
    resetState();
    queryKey = undefined;
    queryValue = undefined;
  };

  // Background directory hints must not abort an explicit navigation.
  const refreshFirstPage = () => {
    if (currentPage > 1 || inFlight) return false;
    reset();
    return true;
  };
  return { reset, pause, load, refreshFirstPage };
}
