import type { Page } from "../src/model/types.js";
import { parsePage } from "../src/parse/page.js";

export function pageFrom(html: string, key = "/"): Page {
  return parsePage(html, key);
}
