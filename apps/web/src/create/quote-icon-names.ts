export function quoteIconFilename(symbol: string): string {
  return symbol === "USDG" ? "usdg.png" : `${symbol.toLowerCase()}.svg`;
}
