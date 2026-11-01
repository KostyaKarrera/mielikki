import WebAutoExtractor from "@marbec/web-auto-extractor";
import type { Severity } from "../../config/schema.js";
import type { PageRule } from "../types.js";
import { getValidator } from "./vocab.js";

const hasStructuredData = (html: string, jsonldCount: number): boolean =>
  jsonldCount > 0 || /\bitemscope\b|\btypeof\s*=/i.test(html);

export const rule: PageRule = {
  meta: {
    id: "schema/validation",
    title: "Structured data validation issue",
    category: "schema",
    severity: "warning",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: false,
    fix: "Fix the structured data property named in the message (see Google's required and recommended properties).",
    source:
      "https://developers.google.com/search/docs/appearance/structured-data/search-gallery",
  },
  async checkPage(page, ctx) {
    if (!hasStructuredData(page.html, page.jsonld.length)) return;
    try {
      const extracted = new WebAutoExtractor({
        addLocation: true,
        embedSource: ["rdfa", "microdata"],
      }).parse(page.html);
      const issues = await (await getValidator()).validate(extracted);
      for (const issue of issues) {
        const severity: Severity =
          issue.severity === "ERROR"
            ? "error"
            : issue.issueMessage.includes("(optional)")
              ? "info"
              : "warning";
        ctx.report({
          message: issue.issueMessage,
          severity,
          details: { fieldNames: issue.fieldNames, rootType: issue.rootType },
        });
      }
    } catch (e) {
      ctx.report({
        message: `Structured data validator failed on this page: ${e instanceof Error ? e.message : String(e)}`,
        severity: "warning",
      });
    }
  },
};
