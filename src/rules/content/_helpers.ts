import { pageKey } from "../../model/url.js";

/** Page key of a configured target url (path or absolute URL). */
export function targetKey(url: string): string {
  return pageKey(URL.canParse(url) ? new URL(url).pathname : url);
}
