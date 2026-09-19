import {navigationKey} from "./navigation.ts";
const PREFIX = "__bb_heading__/";

export function readNavigationHeadings(order: readonly string[]): Map<string, string> {
  const headings = new Map<string, string>();
  for (const entry of order) {
    if (!entry.startsWith(PREFIX)) continue;
    try {
      const value: unknown = JSON.parse(entry.slice(PREFIX.length));
      if (Array.isArray(value) && value.length === 2 &&
          typeof value[0] === "string" && typeof value[1] === "string" &&
          value[1].trim()) headings.set(navigationKey(value[0]), value[1].trim());
    } catch {}
  }
  return headings;
}

export function preserveNavigationHeadings(order: readonly string[], previous: readonly string[]): string[] {
  return [...order.filter((entry) => !entry.startsWith(PREFIX)),
    ...previous.filter((entry) => entry.startsWith(PREFIX))];
}

export function setNavigationHeading(order: readonly string[], key: string, title: string): string[] {
  const headings = readNavigationHeadings(order);
  key = navigationKey(key);
  if (title.trim()) headings.set(key, title.trim().slice(0, 120));
  else headings.delete(key);
  return [...order.filter((entry) => !entry.startsWith(PREFIX)),
    ...Array.from(headings, ([id, label]) => PREFIX + JSON.stringify([id, label]))];
}
