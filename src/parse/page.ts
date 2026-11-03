import { type CheerioAPI, load } from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  Heading,
  Img,
  JsonLdBlock,
  Link,
  Page,
  Resource,
} from "../model/types.js";

const CHROME_TAGS = ["header", "nav", "footer"];
const CHROME = CHROME_TAGS.join(", ");
const NON_CONTENT = ["script", "style", "noscript", "template"];
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function metaMap($: CheerioAPI, attr: "property" | "name", prefix: string) {
  const out: Record<string, string> = {};
  $(`meta[${attr}]`).each((_, el) => {
    const k = ($(el).attr(attr) ?? "").trim().toLowerCase();
    if (k.startsWith(prefix) && !(k in out))
      out[k] = $(el).attr("content") ?? "";
  });
  return out;
}

/**
 * Content region: <main> if present, else <body>; tags whose subtrees do not
 * count as content (non-content, plus page chrome when there is no <main>).
 * The tree is walked in place, never cloned (cloning is slow and recursive).
 */
function contentRoot($: CheerioAPI): { roots: AnyNode[]; skip: Set<string> } {
  const main = $("main").first();
  const skip = new Set(NON_CONTENT);
  if (main.length === 0) for (const t of CHROME_TAGS) skip.add(t);
  return { roots: (main.length > 0 ? main : $("body")).toArray(), skip };
}

function parseJsonLd($: CheerioAPI): JsonLdBlock[] {
  const blocks: JsonLdBlock[] = [];
  $("script").each((_, el) => {
    if (
      ($(el).attr("type") ?? "").trim().toLowerCase() !== "application/ld+json"
    )
      return;
    const raw = $(el).text();
    try {
      blocks.push({ raw, data: JSON.parse(raw) as unknown });
    } catch (e) {
      blocks.push({ raw, error: e instanceof Error ? e.message : String(e) });
    }
  });
  return blocks;
}

function parseForms($: CheerioAPI) {
  const labelFor = new Set<string>();
  $("label[for]").each((_, el) => {
    labelFor.add($(el).attr("for") ?? "");
  });
  const formControls: Page["formControls"] = [];
  $("input, textarea, select").each((_, el) => {
    const $el = $(el);
    const tag = (el as { tagName: string }).tagName.toLowerCase();
    const type = $el.attr("type")?.trim().toLowerCase();
    if (
      tag === "input" &&
      type &&
      ["hidden", "submit", "button"].includes(type)
    )
      return;
    const id = $el.attr("id");
    const labelled =
      (id !== undefined && id !== "" && labelFor.has(id)) ||
      $el.closest("label").length > 0 ||
      ($el.attr("aria-label") ?? "").trim() !== "" ||
      ($el.attr("aria-labelledby") ?? "").trim() !== "";
    formControls.push({ tag, type, labelled });
  });
  const buttons: Page["buttons"] = [];
  $("button").each((_, el) => {
    const $el = $(el);
    const named =
      collapse($el.text()) !== "" ||
      ($el.attr("aria-label") ?? "").trim() !== "" ||
      ($el.attr("aria-labelledby") ?? "").trim() !== "";
    buttons.push({ named });
  });
  return { formControls, buttons };
}

const BLOCK_TAGS = new Set(
  "p div section article li ul ol h1 h2 h3 h4 h5 h6 br tr td th blockquote pre table figure figcaption dt dd header footer nav aside main form label button option hr".split(
    " ",
  ),
);

/**
 * Text of `nodes` with a space around every block element, so adjacent blocks
 * do not glue words together; subtrees of `skip` tags are left out. One
 * iterative walk (no recursion, no tree mutation). Also returns the text of
 * the first non-empty <p>.
 */
function blockText(
  nodes: AnyNode[],
  skip: ReadonlySet<string>,
  wantParagraph = false,
): { text: string; firstParagraph?: string } {
  const parts: string[] = [];
  let firstParagraph: string | undefined;
  const stack: (AnyNode | string)[] = [...nodes].reverse();
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    if (typeof n === "string") {
      parts.push(n);
    } else if (n.type === "text") {
      parts.push(n.data);
    } else if (n.type === "tag" || n.type === "cdata" || n.type === "root") {
      if (n.type === "tag") {
        if (skip.has(n.name)) continue;
        if (wantParagraph && firstParagraph === undefined && n.name === "p") {
          const t = blockText([n], skip).text;
          if (t !== "") firstParagraph = t;
        }
      }
      const block = n.type === "tag" && BLOCK_TAGS.has(n.name);
      if (block) {
        parts.push(" ");
        stack.push(" ");
      }
      for (let i = n.children.length - 1; i >= 0; i--)
        stack.push(n.children[i] as AnyNode);
    }
  }
  return { text: collapse(parts.join("")), firstParagraph };
}

function parseResources($: CheerioAPI): Resource[] {
  const out: Resource[] = [];
  $(
    "script[src], link[href], iframe[src], video[src], audio[src], source[src]",
  ).each((_, el) => {
    const $el = $(el);
    const tag = (el as { tagName: string }).tagName.toLowerCase();
    if (tag === "script") {
      out.push({ kind: "script", src: ($el.attr("src") ?? "").trim() });
    } else if (tag === "link") {
      const rel = ($el.attr("rel") ?? "").toLowerCase().split(/\s+/);
      const src = ($el.attr("href") ?? "").trim();
      if (rel.includes("stylesheet")) out.push({ kind: "style", src });
      else if (rel.includes("modulepreload")) out.push({ kind: "script", src });
      else if (rel.includes("preload")) {
        const as = ($el.attr("as") ?? "").trim().toLowerCase();
        out.push({
          kind: as === "script" ? "script" : as === "style" ? "style" : "other",
          src,
        });
      }
    } else if (tag === "iframe") {
      out.push({ kind: "iframe", src: ($el.attr("src") ?? "").trim() });
    } else {
      out.push({ kind: "media", src: ($el.attr("src") ?? "").trim() });
    }
  });
  return out;
}

export function parsePage(html: string, key: string, file?: string): Page {
  const $ = load(html.replace(/^\uFEFF/, ""));

  const titles = $("title");
  const canonicals = $('link[rel~="canonical" i]');
  // robots and googlebot metas both apply to Google; 'none' = noindex, nofollow.
  const robotsMeta = [
    ...new Set(
      $('meta[name="robots" i], meta[name="googlebot" i]')
        .toArray()
        .flatMap((el) =>
          ($(el).attr("content") ?? "").toLowerCase().split(/[\s,]+/),
        )
        .flatMap((t) => (t === "none" ? ["noindex", "nofollow"] : [t]))
        .filter((t) => t !== ""),
    ),
  ];

  const hreflang: Page["hreflang"] = [];
  $('link[rel~="alternate" i][hreflang]').each((_, el) => {
    hreflang.push({
      lang: $(el).attr("hreflang") ?? "",
      href: $(el).attr("href") ?? "",
    });
  });

  const { roots, skip } = contentRoot($);
  const { text: mainText, firstParagraph } = blockText(roots, skip, true);

  const headings: Heading[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = Number(
      (el as { tagName: string }).tagName.slice(1),
    ) as Heading["level"];
    headings.push({ level, text: collapse($(el).text()) });
  });

  const links: Link[] = [];
  const tel: string[] = [];
  const mailto: string[] = [];
  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = ($el.attr("href") ?? "").trim();
    const lower = href.toLowerCase();
    if (lower.startsWith("tel:")) tel.push(href.slice(4).replace(/\s+/g, ""));
    else if (lower.startsWith("mailto:"))
      mailto.push(href.slice(7).replace(/\s+/g, ""));
    const label =
      collapse($el.attr("aria-label") ?? "") ||
      collapse(
        $el
          .find("img[alt]")
          .toArray()
          .map((img) => $(img).attr("alt") ?? "")
          .join(" "),
      );
    links.push({
      href,
      internal: !SCHEME.test(href) && !href.startsWith("//"),
      text: collapse($el.text()),
      label: label === "" ? undefined : label,
      rel: ($el.attr("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean),
      inChrome: $el.closest(CHROME).length > 0,
    });
  });

  const hasMain = $("main").length > 0;
  const images: Img[] = [];
  $("img").each((index, el) => {
    const $el = $(el);
    images.push({
      src: ($el.attr("src") ?? "").trim(),
      alt: $el.attr("alt") ?? null,
      width: $el.attr("width"),
      height: $el.attr("height"),
      loading: $el.attr("loading"),
      inMain: hasMain
        ? $el.closest("main").length > 0
        : $el.closest(CHROME).length === 0,
      index,
    });
  });

  const charsetMeta = $("meta[charset]").first().attr("charset");
  const httpEquiv = $('meta[http-equiv="content-type" i]')
    .first()
    .attr("content");
  const charset =
    charsetMeta ?? /charset=([^;\s]+)/i.exec(httpEquiv ?? "")?.[1];

  return {
    key,
    file,
    html,
    lang: $("html").attr("lang"),
    charset,
    viewport: $('meta[name="viewport" i]').first().attr("content"),
    title: titles.length > 0 ? collapse(titles.first().text()) : undefined,
    titleCount: titles.length,
    metaDescription: $('meta[name="description" i]').first().attr("content"),
    canonical: canonicals.first().attr("href"),
    canonicalCount: canonicals.length,
    robotsMeta,
    hreflang,
    og: metaMap($, "property", "og:"),
    twitter: metaMap($, "name", "twitter:"),
    headings,
    mainText,
    firstParagraph,
    wordCount: mainText === "" ? 0 : mainText.split(" ").length,
    links,
    images,
    jsonld: parseJsonLd($),
    tel,
    mailto,
    ...parseForms($),
    resources: parseResources($),
  };
}
