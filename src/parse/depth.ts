/**
 * Linear pre-scan of the maximum element nesting depth.
 *
 * parse5 (inside cheerio) is quadratic on deeply nested unclosed block tags,
 * so a hostile page must be refused BEFORE it is parsed. This scan is a cheap
 * tolerant tokenizer, not a parser: it only needs to over- or under-count a
 * little, never to be slow.
 */

/** Maximum nesting depth Mielikki parses; deeper pages are refused. */
export const MAX_NESTING = 1500;

const VOID = new Set([
  "area",
  "base",
  "basefont",
  "bgsound",
  "br",
  "col",
  "command",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
/** End tag is optional, so the parser closes them implicitly: they never nest. */
const OPTIONAL_END = new Set([
  "p",
  "li",
  "dt",
  "dd",
  "tr",
  "td",
  "th",
  "tbody",
  "thead",
  "tfoot",
  "colgroup",
  "option",
  "optgroup",
  "rt",
  "rp",
]);
const RAW_TEXT = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
]);

const isAlpha = (c: number): boolean =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isSpace = (c: number): boolean =>
  c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

export function maxOpenDepth(html: string): number {
  const n = html.length;
  let depth = 0;
  let max = 0;
  let foreign = 0; // open <svg>/<math>: `/>` really self-closes there
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    const c1 = html.charCodeAt(lt + 1);
    if (c1 === 33 /* ! */) {
      if (html.startsWith("<!--", lt)) {
        const end = html.indexOf("-->", lt + 4);
        i = end === -1 ? n : end + 3;
      } else {
        const end = html.indexOf(">", lt + 2);
        i = end === -1 ? n : end + 1;
      }
      continue;
    }
    if (c1 === 63 /* ? */) {
      const end = html.indexOf(">", lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const closing = c1 === 47; /* / */
    const nameStart = lt + (closing ? 2 : 1);
    if (!isAlpha(html.charCodeAt(nameStart))) {
      i = lt + 1;
      continue;
    }
    let p = nameStart;
    while (p < n) {
      const c = html.charCodeAt(p);
      if (isSpace(c) || c === 47 || c === 62) break;
      p++;
    }
    const name = html.slice(nameStart, p).toLowerCase();
    // skip attributes up to the closing '>', honouring quoted values
    let prev = 0; // previous non-space char
    while (p < n) {
      const c = html.charCodeAt(p);
      if (c === 62) break;
      if ((c === 34 || c === 39) && prev === 61 /* = */) {
        const end = html.indexOf(html[p] as string, p + 1);
        if (end === -1) {
          p = n;
          break;
        }
        p = end + 1;
        prev = c;
        continue;
      }
      if (!isSpace(c)) prev = c;
      p++;
    }
    const selfClose = prev === 47;
    i = p + 1;
    if (closing) {
      if (name === "svg" || name === "math") foreign = Math.max(0, foreign - 1);
      if (!VOID.has(name) && !OPTIONAL_END.has(name))
        depth = Math.max(0, depth - 1);
      continue;
    }
    if (VOID.has(name) || OPTIONAL_END.has(name)) continue;
    if (selfClose && foreign > 0) continue;
    if (RAW_TEXT.has(name)) {
      // content is text up to the matching end tag; the element does not nest
      const re = new RegExp(`</${name}[\\s/>]`, "gi");
      re.lastIndex = i;
      const m = re.exec(html);
      i = m ? m.index : n;
      continue;
    }
    if (name === "svg" || name === "math") foreign++;
    depth++;
    if (depth > max) max = depth;
  }
  return max;
}
