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
  return icons.get(quoteIconFilename(symbol));
}
