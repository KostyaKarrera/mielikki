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
const RAW_END = new Map(
  [...RAW_TEXT].map((t) => [t, new RegExp(`</${t}[\\s/>]`, "gi")]),
);
const COMMENT_END = /--!?>/g;

/**
 * Maximum open-element depth. A construct that never terminates (comment,
 * quote, tag, raw text) ends the scan early with what was counted so far: the
 * page is then not proven shallow, which is why untrusted pages additionally
 * go through the time- and memory-limited worker (parsePageSafe).
 *
 * Only a closing tag that matches an open element pops (like the HTML parser,
 * which ignores stray end tags).
 */
export function maxOpenDepth(html: string): number {
  const n = html.length;
  const stack: string[] = [];
  const open = new Map<string, number>();
  let max = 0;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    const c1 = html.charCodeAt(lt + 1);
    if (c1 === 33 /* ! */) {
      if (html.startsWith("<!--", lt)) {
        // `<!-->` and `<!--->` end the comment at once; otherwise `-->` or `--!>`
        if (html.startsWith("<!-->", lt)) {
          i = lt + 5;
        } else if (html.startsWith("<!--->", lt)) {
          i = lt + 6;
        } else {
          COMMENT_END.lastIndex = lt + 4;
          const m = COMMENT_END.exec(html);
          if (!m) break;
          i = m.index + m[0].length;
        }
      } else {
        const end = html.indexOf(">", lt + 2);
        if (end === -1) break;
        i = end + 1;
      }
      continue;
    }
    if (c1 === 63 /* ? */) {
      const end = html.indexOf(">", lt + 2);
      if (end === -1) break;
      i = end + 1;
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
    // attributes, tokenized like the HTML spec: a name may start with '=' or a
    // quote; a quote only opens a value right after `name=`
    let selfClose = false;
    let terminated = false;
    while (p < n) {
      let c = html.charCodeAt(p);
      if (isSpace(c)) {
        p++;
        continue;
      }
      if (c === 62) {
        terminated = true;
        break;
      }
      if (c === 47) {
        selfClose = html.charCodeAt(p + 1) === 62;
        p++;
        continue;
      }
      selfClose = false;
      p++; // first char of an attribute name, whatever it is
      while (p < n) {
        c = html.charCodeAt(p);
        if (isSpace(c) || c === 47 || c === 62 || c === 61) break;
        p++;
      }
      while (p < n && isSpace(html.charCodeAt(p))) p++;
      if (html.charCodeAt(p) !== 61) continue;
      p++;
      while (p < n && isSpace(html.charCodeAt(p))) p++;
      c = html.charCodeAt(p);
      if (c === 34 || c === 39) {
        const end = html.indexOf(html[p] as string, p + 1);
        if (end === -1) {
          p = n;
          break;
        }
        p = end + 1;
      } else {
        while (p < n) {
          c = html.charCodeAt(p);
          if (isSpace(c) || c === 62) break;
          p++;
        }
      }
    }
    if (!terminated) break;
    i = p + 1;
    const foreign = (open.get("svg") ?? 0) + (open.get("math") ?? 0) > 0;
    if (closing) {
      const count = open.get(name) ?? 0;
      if (count === 0) continue;
      const at = stack.lastIndexOf(name);
      for (let k = stack.length - 1; k >= at; k--) {
        const nm = stack[k] as string;
        open.set(nm, (open.get(nm) ?? 1) - 1);
      }
      stack.length = at;
      continue;
    }
    if (!foreign && (VOID.has(name) || OPTIONAL_END.has(name))) continue;
    if (selfClose && foreign) continue;
    if (!foreign && RAW_TEXT.has(name)) {
      // content is text up to the matching end tag; the element does not nest
      const re = RAW_END.get(name) as RegExp;
      re.lastIndex = i;
      const m = re.exec(html);
      if (!m) break; // swallows the rest of the document
      i = m.index;
      continue;
    }
    stack.push(name);
    open.set(name, (open.get(name) ?? 0) + 1);
    if (stack.length > max) max = stack.length;
    if (max > MAX_NESTING) return max; // over the cap: no need to read on
  }
  return max;
}
