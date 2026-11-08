import {stockBrandLogoUrl} from './stock-branding.ts';
import { quoteIconFilename } from "./quote-icon-names.ts";

const modules = import.meta.glob(["../../assets/quotes/*.svg", "../../assets/quotes/*.png"], {
  eager: true,
  import: "default",
  query: "?url",
}) as Record<string, string>;

const icons = new Map(
  Object.entries(modules).map(([path, url]) => [path.split("/").pop() ?? "", url]),
);

export function quoteIconUrl(symbol: string): string | undefined {
  if (symbol === 'BNB') return new URL('../../assets/networks/bnb.png', import.meta.url).href;
  return stockBrandLogoUrl(symbol) ?? icons.get(quoteIconFilename(symbol));
}

export function assetLogoUrl(filename: string): string | undefined {
  return icons.get(filename);
}
