/** Translate implementation diagnostics at the presentation boundary only. */
export function publicMessage(value: string): string {
  // Transport diagnostics can contain provider URLs, request bodies and calldata.
  // Keep them out of the UI; these failures do not mean the contract reverted.
  if (/HTTP request failed|Failed to fetch|fetch failed|Network request failed|HTTP request took too long/i.test(value)) {
    return "Network connection unavailable. Please try again shortly.";
  }
  return value
    // Keep protocol names and identifiers internal; translate readable diagnostics only.
    .replace(/\b(?:not[- ]graduated|ungraduated)\b/gi, "Growing")
    .replace(/\bgraduated\b/gi, "Bloomed")
    .replace(/\bgraduation\b/gi, "blooming")
    .replace(/\bgraduate\b/gi, "bloom")
    .replace(/VITE_V1_READ_API_URL(?: is missing)?/g, "Market data service is not configured")
    .replace(/VITE_V1_TREASURY_PROOF_API_URL(?: is missing)?/g, "Reward proof service is not configured")
    .replace(/VITE_V1_[A-Z0-9_]+/g, "Protocol configuration")
    .replace(/V1-[A-Z0-9_:-]+/g, "current protocol")
    .replace(/\b([A-Za-z]+)V1\b/g, "$1")
    .replace(/\bV1\b\s*/gi, "")
    .replace(/ {2,}/g, " ");
}
