/** Translate implementation diagnostics at the presentation boundary only. */
export function publicMessage(value: string): string {
  // Transport diagnostics can contain provider URLs, request bodies and calldata.
  // Keep them out of the UI; these failures do not mean the contract reverted.
  if (/HTTP request failed|Failed to fetch|fetch failed|Network request failed|HTTP request took too long/i.test(value)) {
    return "Network connection unavailable. Please try again shortly.";
  }
  return value
    .replace(/\bcanonical (?:trading )?route\b/gi, "trading route")
    .replace(/\bmarket snapshot\b/gi, "market data")
    .replace(/\bverified (?:directory|market) data\b/gi, "current market data")
    .replace(/\bPoolManager\b/g, "liquidity pool")
    // Keep protocol names and identifiers internal; translate readable diagnostics only.
    .replace(/\b(?:not[- ]graduated|ungraduated)\b/gi, "Growing")
    .replace(/\bgraduated\b/gi, "Bloomed")
    .replace(/\bgraduation\b/gi, "blooming")
    .replace(/\bgraduate\b/gi, "bloom")
    .replace(/VITE_V1_READ_API_URL(?: is missing)?/g, "Market data is temporarily unavailable. Please try again shortly.")
    .replace(/VITE_V1_TREASURY_PROOF_API_URL(?: is missing)?/g, "Rewards are temporarily unavailable. Please try again shortly.")
    .replace(/VITE_V1_[A-Z0-9_]+/g, "Service temporarily unavailable")
    .replace(/V1-[A-Z0-9_:-]+/g, "current protocol")
    .replace(/\b([A-Za-z]+)V1\b/g, "$1")
    .replace(/\bV1\b\s*/gi, "")
    .replace(/ {2,}/g, " ");
}
