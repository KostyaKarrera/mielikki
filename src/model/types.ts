import type { Config } from "../config/schema.js";
import type { RobotsInfo } from "../parse/robots.js";
import type { SitemapInfo } from "../parse/sitemap.js";

export interface Link {
  href: string;
  key?: string;
  internal: boolean;
  text: string;
  /** aria-label, or alt text of a nested <img>; undefined when neither is non-empty. */
  label?: string;
  rel: string[];
  inChrome: boolean;
}

export interface Img {
  src: string;
  key?: string;
  alt: string | null;
  width?: string;
  height?: string;
  loading?: string;
  inMain: boolean;
  index: number;
}

export interface JsonLdBlock {
  raw: string;
  data?: unknown;
  error?: string;
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface Page {
  key: string; // pageKey (Task 4), e.g. '/palvelut/'
  file?: string; // path relative to dist
  status?: number;
  headers?: Record<string, string>; // URL mode (plan 2)
  html: string;
  lang?: string;
  charset?: string;
  viewport?: string;
  title?: string;
  titleCount: number;
  metaDescription?: string;
  canonical?: string;
  canonicalCount: number;
  robotsMeta: string[]; // lowercase tokens
  hreflang: { lang: string; href: string }[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  headings: Heading[];
  mainText: string;
  firstParagraph?: string;
  wordCount: number;
  links: Link[];
  images: Img[];
  jsonld: JsonLdBlock[];
  tel: string[];
  mailto: string[];
  formControls: { tag: string; type?: string; labelled: boolean }[];
  buttons: { named: boolean }[];
}

export interface Asset {
  key: string;
  bytes: number;
  ext: string; // lowercase, without the dot ('jpg')
}

export interface Site {
  input: { kind: "dir" | "url"; root: string };
  config: Config;
  site?: string; // base URL
  pages: Page[]; // sorted by key; without 404
  notFound?: Page;
  robots?: RobotsInfo;
  sitemaps: SitemapInfo[];
  assets: Map<string, Asset>; // all non-HTML files, key = '/img/a.jpg' (decoded)
  byKey: Map<string, Page>;
  inlinks: Map<string, string[]>; // key -> page keys linking from content (not inChrome)
  inlinksAll: Map<string, string[]>; // including inChrome
  depth: Map<string, number>; // BFS from '/' over all internal links
}
