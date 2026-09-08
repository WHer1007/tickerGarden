/** Translate implementation diagnostics at the presentation boundary only. */
export function publicMessage(value: string): string {
  return value
    .replace(/VITE_V1_READ_API_URL(?: is missing)?/g, "Market data service is not configured")
    .replace(/VITE_V1_TREASURY_PROOF_API_URL(?: is missing)?/g, "Reward proof service is not configured")
    .replace(/VITE_V1_[A-Z0-9_]+/g, "Protocol configuration")
    .replace(/V1-[A-Z0-9_:-]+/g, "current protocol")
    .replace(/\b([A-Za-z]+)V1\b/g, "$1")
    .replace(/\bV1\b\s*/gi, "")
    .replace(/ {2,}/g, " ");
}
