export interface Link {
  href: string;
  key?: string;
  internal: boolean;
  text: string;
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
