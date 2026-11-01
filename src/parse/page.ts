import { type Cheerio, type CheerioAPI, load } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Heading, Img, JsonLdBlock, Link, Page } from "../model/types.js";

const CHROME = "header, nav, footer";
const NON_CONTENT = "script, style, noscript, template";
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

/** Content region: <main> if present, else <body> without page chrome. */
function contentRoot($: CheerioAPI): Cheerio<AnyNode> {
  const main = $("main").first();
  const root = (main.length > 0 ? main : $("body")).clone();
  root.find(NON_CONTENT).remove();
  if (main.length === 0) root.find(CHROME).remove();
  return root;
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

export function parsePage(html: string, key: string, file?: string): Page {
  const $ = load(html.replace(/^﻿/, ""));

  const titles = $("title");
  const canonicals = $('link[rel~="canonical" i]');
  const robotsMeta = $('meta[name="robots" i]')
    .toArray()
    .flatMap((el) =>
      ($(el).attr("content") ?? "").toLowerCase().split(/[\s,]+/),
    )
    .filter((t) => t !== "");

  const hreflang: Page["hreflang"] = [];
  $('link[rel~="alternate" i][hreflang]').each((_, el) => {
    hreflang.push({
      lang: $(el).attr("hreflang") ?? "",
      href: $(el).attr("href") ?? "",
    });
  });

  const root = contentRoot($);
  const mainText = collapse(root.text());
  let firstParagraph: string | undefined;
  root.find("p").each((_, el) => {
    const t = collapse($(el).text());
    if (t !== "") {
      firstParagraph = t;
      return false;
    }
    return undefined;
  });

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
  };
}
