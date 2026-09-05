/** Editorial display only. These identities are not a market or asset allowlist. */
export const GARDEN_FRUITS = [
  { symbol: "NVDA", name: "NVIDIA", story: "A culture of accelerated ideas.", color: "#c5ed42", position: [-0.57, 1.86, 0.25] },
  { symbol: "AAPL", name: "Apple", story: "A different way to think and grow.", color: "#f2e6c7", position: [0.57, 1.75, 0.12] },
  { symbol: "MSFT", name: "Microsoft", story: "Builders, big ideas, shared roots.", color: "#fb8065", position: [-1.36, 1.13, 0.48] },
  { symbol: "AMZN", name: "Amazon", story: "Every big story starts somewhere.", color: "#c5ed42", position: [-0.3, 0.93, 0.82] },
  { symbol: "GOOGL", name: "Alphabet", story: "Curiosity branches in every direction.", color: "#c5ed42", position: [1.39, 1.12, 0.37] },
  { symbol: "META", name: "Meta", story: "Connections make a community.", color: "#e9dfbd", position: [-1.61, 0.24, 0.4] },
  { symbol: "TSLA", name: "Tesla", story: "A little electric. A lot of imagination.", color: "#fb8065", position: [-0.78, 0.11, 0.93] },
  { symbol: "AVGO", name: "Broadcom", story: "Small signals. Endless possibilities.", color: "#c5ed42", position: [0.57, 0.26, 0.92] },
  { symbol: "JPM", name: "JPMorgan Chase", story: "Old roots. New conversations.", color: "#e9dfbd", position: [0.93, -0.48, 0.53] },
  { symbol: "COST", name: "Costco", story: "A place for the whole community.", color: "#fb8065", position: [1.74, 0.19, 0.08] },
] as const;

export function wrapFruitIndex(index: number): number {
  return ((index % GARDEN_FRUITS.length) + GARDEN_FRUITS.length) % GARDEN_FRUITS.length;
}
