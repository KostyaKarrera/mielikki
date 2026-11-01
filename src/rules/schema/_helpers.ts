import type { Config } from "../../config/schema.js";
import type { Page } from "../../model/types.js";

export type Node = Record<string, unknown>;
export type Business = NonNullable<Config["business"]>;

const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function collect(value: unknown, out: Node[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collect(v, out);
  } else if (isNode(value)) {
    out.push(value);
    for (const key of Object.keys(value)) collect(value[key], out);
  }
}

/** Every JSON-LD object on the page: top level, @graph members and nested values. */
export function nodesOf(page: Page): Node[] {
  const out: Node[] = [];
  for (const block of page.jsonld) {
    if (block.error === undefined) collect(block.data, out);
  }
  return out;
}

export function typesOf(node: Node): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t))
    return t.filter((x): x is string => typeof x === "string");
  return [];
}

export function businessNodes(page: Page, business: Business): Node[] {
  return nodesOf(page).filter((n) => typesOf(n).includes(business.schemaType));
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const plus = phone.trim().startsWith("+");
  if (!plus && digits.startsWith("00")) return `+${digits.slice(2)}`;
  return plus ? `+${digits}` : digits;
}

export const normalizeName = (name: string): string =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

export const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
