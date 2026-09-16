/** Cache both success and failure briefly; concurrent probes share one DB check. */
export function cachedProbe<T>(check: () => Promise<T>, ttlMs = 5000, now = Date.now): () => Promise<T> {
  let pending: Promise<T> | undefined;
  let expires = 0;
  return () => {
    if (!pending || now() >= expires) {
      expires = Infinity;
      pending = Promise.resolve().then(check).finally(() => { expires = now() + ttlMs; });
    }
    return pending;
  };
}

export async function limitedText(request: Request, limit = 1024 * 1024): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size).toString('utf8');
}
