import type { PageRule } from "../types.js";

const BUILTIN = ["lorem ipsum", "TODO", "TBD", "PLACEHOLDER"];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

function compile(marker: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegex(marker)}(?![\\p{L}\\p{N}_])`,
    "iu",
  );
}

export const rule: PageRule = {
  meta: {
    id: "content/placeholder",
    title: "Placeholder text left on page",
    category: "content",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Replace the placeholder text with real content before launch.",
    source: "mielikki:original",
  },
  checkPage(page, ctx) {
    const fields: [string, string][] = [
      ["title", page.title ?? ""],
      ["description", page.metaDescription ?? ""],
      ["text", page.mainText],
      ...page.images.map((i): [string, string] => ["image alt", i.alt ?? ""]),
      ...Object.keys(page.og)
        .sort()
        .map((k): [string, string] => [k, page.og[k] ?? ""]),
    ];
    const markers = [
      ...new Set(
        [...BUILTIN, ...ctx.config.placeholders].filter((m) => m !== ""),
      ),
    ];
    for (const marker of markers) {
      const re = compile(marker);
      const where = [
        ...new Set(fields.filter(([, v]) => re.test(v)).map(([f]) => f)),
      ];
      if (where.length > 0)
        ctx.report({
          message: `Placeholder "${marker}" found in ${where.join(", ")}`,
          details: { marker, fields: where },
        });
    }
  },
};
