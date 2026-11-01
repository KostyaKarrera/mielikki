import { rule as r0 } from "./crawl/canonical-target.js";
import { rule as r1 } from "./crawl/depth.js";
import { rule as r2 } from "./crawl/noindex.js";
import { rule as r3 } from "./crawl/noindex-expected-missing.js";
import { rule as r4 } from "./crawl/orphan.js";
import { rule as r5 } from "./crawl/robots-blocks-all.js";
import { rule as r6 } from "./crawl/robots-blocks-assets.js";
import { rule as r7 } from "./crawl/robots-blocks-page.js";
import { rule as r8 } from "./crawl/robots-missing.js";
import { rule as r9 } from "./crawl/robots-no-sitemap.js";
import { rule as r10 } from "./crawl/sitemap-bad-entry.js";
import { rule as r11 } from "./crawl/sitemap-foreign-host.js";
import { rule as r12 } from "./crawl/sitemap-invalid.js";
import { rule as r13 } from "./crawl/sitemap-missing.js";
import { rule as r14 } from "./crawl/sitemap-missing-page.js";
import { rule as r15 } from "./crawl/thin-html.js";
import type { Rule } from "./types.js";

export const allRules: Rule[] = [
  r0,
  r1,
  r2,
  r3,
  r4,
  r5,
  r6,
  r7,
  r8,
  r9,
  r10,
  r11,
  r12,
  r13,
  r14,
  r15,
];
